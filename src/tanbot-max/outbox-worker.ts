import type { Pool, PoolClient } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport } from "./delivery-transport";
import { findAccountByUserId } from "./link-repository";
import { canDeliverTanTrackerOutboxNotification } from "../tanbot-telegram/tan-tracker-access";
import { transferStillExists } from "../tan-tracker/registry-cleanup/cancel-transfer-notifications";
import { isTanTrackerStaffOutboxEvent } from "../tan-tracker/tan-tracker-outbox-messages";
import { buildTanTrackerStaffMaxOutboxDelivery } from "../tan-tracker/staff-max-outbox-presentation";

const MAX_ATTEMPTS = 8;

export type MaxOutboxProcessResult = {
  processed: number;
  sent: number;
  failed: number;
  cancelled: number;
};

async function loadPendingMax(client: PoolClient, limit: number) {
  return client.query<{
    id: string;
    user_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    attempt_count: number;
  }>(
    `SELECT id::text, user_id::text, event_type, payload, attempt_count
     FROM tanbot_notification_outbox
     WHERE channel = 'max' AND status = 'pending' AND next_attempt_at <= NOW()
     ORDER BY created_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );
}

export async function processTanbotMaxNotificationOutbox(
  pool: Pool,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  options: { limit?: number; deliveryEnabled?: boolean } = {},
): Promise<MaxOutboxProcessResult> {
  const limit = options.limit ?? 20;
  const deliveryEnabled = options.deliveryEnabled ?? config.deliveryEnabled;
  const result: MaxOutboxProcessResult = { processed: 0, sent: 0, failed: 0, cancelled: 0 };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await loadPendingMax(client, limit);
    for (const row of batch.rows) {
      result.processed += 1;
      await client.query(`UPDATE tanbot_notification_outbox SET status = 'processing' WHERE id = $1::uuid`, [row.id]);

      if (!deliveryEnabled) {
        await client.query(
          `UPDATE tanbot_notification_outbox SET status = 'pending', next_attempt_at = NOW() + interval '1 minute'
           WHERE id = $1::uuid`,
          [row.id],
        );
        continue;
      }

      const account = await findAccountByUserId(client, row.user_id);
      if (!account || account.stopped_at || !account.notifications_enabled) {
        await client.query(
          `UPDATE tanbot_notification_outbox SET status = 'cancelled', last_error_code = 'NO_SUBSCRIPTION' WHERE id = $1::uuid`,
          [row.id],
        );
        result.cancelled += 1;
        continue;
      }

      const live = await client.query<{ status: string }>(
        `SELECT status FROM tanbot_notification_outbox WHERE id = $1::uuid`,
        [row.id],
      );
      if (live.rows[0]?.status !== "processing") {
        continue;
      }

      if (isTanTrackerStaffOutboxEvent(row.event_type)) {
        const transferId = String(row.payload.transferId ?? "");
        if (transferId && !(await transferStillExists(client, transferId))) {
          await client.query(
            `UPDATE tanbot_notification_outbox SET status = 'cancelled', last_error_code = 'TRANSFER_DELETED' WHERE id = $1::uuid`,
            [row.id],
          );
          result.cancelled += 1;
          continue;
        }
        const hv = Number(row.payload.handoffVersion ?? 0);
        const allowed = await canDeliverTanTrackerOutboxNotification(
          client,
          row.user_id,
          transferId,
          hv,
          row.event_type,
        );
        if (!allowed) {
          await client.query(
            `UPDATE tanbot_notification_outbox SET status = 'cancelled', last_error_code = 'NO_ACCESS' WHERE id = $1::uuid`,
            [row.id],
          );
          result.cancelled += 1;
          continue;
        }
      }

      if (row.event_type === "tan_tracker.external_created") {
        const intended = await client.query(
          `SELECT 1 FROM tt_transfers t
           JOIN tt_parties p ON p.id=t.pending_party_id AND p.kind='user'
           WHERE t.id=$1 AND t.handoff_version=$2 AND p.user_id=$3::uuid
             AND t.status IN ('waiting','active')`,
          [String(row.payload.transferId ?? ""), Number(row.payload.handoffVersion ?? 0), row.user_id],
        );
        if (!intended.rows.length) {
          await client.query(
            `UPDATE tanbot_notification_outbox SET status='cancelled',last_error_code='STALE_EXTERNAL_INTAKE' WHERE id=$1::uuid`,
            [row.id],
          );
          result.cancelled += 1;
          continue;
        }
      }

      const delivery = isTanTrackerStaffOutboxEvent(row.event_type)
        ? buildTanTrackerStaffMaxOutboxDelivery(row.event_type, row.payload, config.appOrigin)
        : { text: "Уведомление Тандор." };

      const send = await transport({
        token: config.botToken,
        userId: BigInt(account.max_user_id),
        text: delivery.text,
        inlineButtons: delivery.inlineButtons,
        shareUrl: delivery.shareUrl,
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      });

      if (send.ok) {
        await client.query(
          `UPDATE tanbot_notification_outbox SET status = 'sent', sent_at = NOW(), attempt_count = attempt_count + 1 WHERE id = $1::uuid`,
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
          `UPDATE tanbot_notification_outbox SET status = 'failed', attempt_count = $2, last_error_code = $3 WHERE id = $1::uuid`,
          [row.id, attempts, send.code],
        );
        result.failed += 1;
      } else {
        await client.query(
          `UPDATE tanbot_notification_outbox SET status = 'pending', attempt_count = $2, last_error_code = $3,
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
