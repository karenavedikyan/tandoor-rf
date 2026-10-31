import type { Pool, PoolClient } from "pg";
import {
  transferInternalIdFromExternalPersonOutboxKey,
  transferStillExists,
} from "../registry-cleanup/cancel-transfer-notifications";

const MAX_ATTEMPTS = 8;

export type ExternalPersonOutboxProcessResult = {
  processed: number;
  sent: number;
  failed: number;
  cancelled: number;
};

type DeliverySendResult = { ok: true } | { ok: false; code: string; retryable?: boolean; retryAfterSeconds?: number };

export type ExternalPersonVerificationTarget =
  | { ok: true; messengerUserId: string; messengerChatId: string }
  | { ok: false; code: "NO_VERIFICATION" | "INVALID_MESSENGER_USER_ID" };

export type ExternalPersonDeliveryTransport = (input: {
  channel: "telegram" | "max";
  chatId: string;
  messengerUserId: string;
  text: string;
  botToken: string;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<DeliverySendResult>;

/** Live verification row must match queued messenger_chat_id (no retargeting). */
export async function resolveExternalPersonOutboxDeliveryTarget(
  client: PoolClient,
  personId: string,
  channel: string,
  queuedChatId: string,
): Promise<ExternalPersonVerificationTarget> {
  const row = await client.query<{ messenger_user_id: string; messenger_chat_id: string }>(
    `SELECT messenger_user_id, messenger_chat_id FROM tt_external_person_verifications
     WHERE person_id = $1::uuid AND channel = $2 AND messenger_chat_id = $3
       AND notifications_enabled = TRUE AND opted_out_at IS NULL
     LIMIT 1`,
    [personId, channel, queuedChatId],
  );
  if ((row.rowCount ?? 0) === 0) {
    return { ok: false, code: "NO_VERIFICATION" };
  }
  const messengerUserId = String(row.rows[0]!.messenger_user_id ?? "").trim();
  if (channel === "max" && (!messengerUserId || !/^\d+$/.test(messengerUserId))) {
    return { ok: false, code: "INVALID_MESSENGER_USER_ID" };
  }
  return {
    ok: true,
    messengerUserId,
    messengerChatId: row.rows[0]!.messenger_chat_id,
  };
}

async function loadPending(client: PoolClient, channel: "telegram" | "max", limit: number) {
  return client.query<{
    id: string;
    person_id: string;
    messenger_chat_id: string;
    body: string;
    attempt_count: number;
    idempotency_key: string;
  }>(
    `SELECT id::text, person_id::text, messenger_chat_id, body, attempt_count, idempotency_key
     FROM tt_external_person_message_outbox
     WHERE channel = $1 AND status = 'pending' AND next_attempt_at <= NOW()
     ORDER BY created_at
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [channel, limit],
  );
}

export async function processExternalPersonMessageOutbox(
  pool: Pool,
  input: {
    channel: "telegram" | "max";
    botToken: string;
    requestTimeoutMs: number;
    maxResponseBytes: number;
    transport: ExternalPersonDeliveryTransport;
    deliveryEnabled?: boolean;
    limit?: number;
  },
): Promise<ExternalPersonOutboxProcessResult> {
  const limit = input.limit ?? 20;
  const deliveryEnabled = input.deliveryEnabled ?? true;
  const result: ExternalPersonOutboxProcessResult = { processed: 0, sent: 0, failed: 0, cancelled: 0 };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await loadPending(client, input.channel, limit);
    for (const row of batch.rows) {
      result.processed += 1;
      await client.query(`UPDATE tt_external_person_message_outbox SET status = 'processing' WHERE id = $1::uuid`, [
        row.id,
      ]);

      if (!deliveryEnabled) {
        await client.query(
          `UPDATE tt_external_person_message_outbox SET status = 'pending', next_attempt_at = NOW() + interval '1 minute'
           WHERE id = $1::uuid`,
          [row.id],
        );
        continue;
      }

      const live = await client.query<{ status: string; idempotency_key: string }>(
        `SELECT status, idempotency_key FROM tt_external_person_message_outbox WHERE id = $1::uuid`,
        [row.id],
      );
      const liveRow = live.rows[0];
      if (!liveRow || liveRow.status !== "processing") {
        continue;
      }

      const linkedTransferId = transferInternalIdFromExternalPersonOutboxKey(liveRow.idempotency_key);
      if (linkedTransferId && !(await transferStillExists(client, linkedTransferId))) {
        await client.query(
          `UPDATE tt_external_person_message_outbox SET status = 'cancelled', last_error_code = 'TRANSFER_DELETED' WHERE id = $1::uuid`,
          [row.id],
        );
        result.cancelled += 1;
        continue;
      }

      const target = await resolveExternalPersonOutboxDeliveryTarget(
        client,
        row.person_id,
        input.channel,
        row.messenger_chat_id,
      );
      if (!target.ok) {
        await client.query(
          `UPDATE tt_external_person_message_outbox SET status = 'cancelled', last_error_code = $2 WHERE id = $1::uuid`,
          [row.id, target.code],
        );
        result.cancelled += 1;
        continue;
      }

      const send = await input.transport({
        channel: input.channel,
        chatId: row.messenger_chat_id,
        messengerUserId: target.messengerUserId,
        text: row.body,
        botToken: input.botToken,
        timeoutMs: input.requestTimeoutMs,
        maxResponseBytes: input.maxResponseBytes,
      });

      if (send.ok) {
        await client.query(
          `UPDATE tt_external_person_message_outbox SET status = 'sent', sent_at = NOW(), attempt_count = attempt_count + 1 WHERE id = $1::uuid`,
          [row.id],
        );
        result.sent += 1;
        continue;
      }

      const attempts = row.attempt_count + 1;
      const retryable = send.retryable === true && attempts < MAX_ATTEMPTS;
      const retryAfter = send.retryAfterSeconds ?? 30;
      if (!retryable || send.code === "FORBIDDEN") {
        await client.query(
          `UPDATE tt_external_person_message_outbox SET status = 'failed', attempt_count = $2, last_error_code = $3 WHERE id = $1::uuid`,
          [row.id, attempts, send.code],
        );
        result.failed += 1;
      } else {
        await client.query(
          `UPDATE tt_external_person_message_outbox SET status = 'pending', attempt_count = $2, last_error_code = $3,
           next_attempt_at = NOW() + ($4::int * interval '1 second') WHERE id = $1::uuid`,
          [row.id, attempts, send.code, retryAfter],
        );
        result.failed += 1;
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return result;
}
