import type { Pool, PoolClient } from "pg";
import { parseTelegramReplyExtra, telegramReplyExtraFromReply } from "../tanbot/webhook-reply-extra";
import type { WebhookReply } from "./webhook-handler";

export type UpdateClaim =
  | { kind: "process" }
  | { kind: "resend"; reply: WebhookReply }
  | { kind: "ignore" };

export async function claimTelegramUpdate(client: PoolClient, updateId: number): Promise<UpdateClaim> {
  const inserted = await client.query(
    `INSERT INTO tanbot_telegram_update_dedup (update_id, status)
     VALUES ($1, 'processing')
     ON CONFLICT (update_id) DO NOTHING
     RETURNING update_id`,
    [updateId],
  );
  if ((inserted.rowCount ?? 0) > 0) {
    return { kind: "process" };
  }

  const existing = await client.query<{
    status: string;
    reply_chat_id: string | null;
    reply_text: string | null;
    reply_extra: unknown;
    reply_delivered_at: Date | null;
  }>(
    `SELECT status, reply_chat_id::text, reply_text, reply_extra, reply_delivered_at
     FROM tanbot_telegram_update_dedup WHERE update_id = $1 FOR UPDATE`,
    [updateId],
  );
  const row = existing.rows[0];
  if (!row) {
    return { kind: "process" };
  }
  if (row.status === "processing") {
    return { kind: "ignore" };
  }
  if (row.status === "failed") {
    await client.query(`UPDATE tanbot_telegram_update_dedup SET status = 'processing' WHERE update_id = $1`, [
      updateId,
    ]);
    return { kind: "process" };
  }
  if (row.reply_delivered_at) {
    return { kind: "ignore" };
  }
  if (row.reply_chat_id && row.reply_text) {
    const extra = parseTelegramReplyExtra(row.reply_extra);
    return {
      kind: "resend",
      reply: {
        chatId: BigInt(row.reply_chat_id),
        text: row.reply_text,
        replyMarkup: extra.replyMarkup,
        answerCallbackQueryId: extra.answerCallbackQueryId,
        replyExtra: extra,
      },
    };
  }
  return { kind: "ignore" };
}

export async function commitTelegramUpdateReply(
  client: PoolClient,
  updateId: number,
  reply: WebhookReply,
): Promise<void> {
  if (!reply) {
    await client.query(
      `UPDATE tanbot_telegram_update_dedup SET status = 'committed', reply_delivered_at = NOW() WHERE update_id = $1`,
      [updateId],
    );
    return;
  }
  const extra = telegramReplyExtraFromReply(reply);
  await client.query(
    `UPDATE tanbot_telegram_update_dedup
     SET status = 'committed', reply_chat_id = $2, reply_text = $3, reply_extra = $4::jsonb
     WHERE update_id = $1`,
    [updateId, reply.chatId.toString(), reply.text, extra ? JSON.stringify(extra) : null],
  );
}

export async function updateTelegramReplyExtra(
  db: Pool | PoolClient,
  updateId: number,
  extra: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE tanbot_telegram_update_dedup SET reply_extra = $2::jsonb WHERE update_id = $1`,
    [updateId, JSON.stringify(extra)],
  );
}

export async function markTelegramUpdateFailed(client: PoolClient, updateId: number): Promise<void> {
  await client.query(`UPDATE tanbot_telegram_update_dedup SET status = 'failed' WHERE update_id = $1`, [updateId]);
}

export async function markTelegramReplyDelivered(db: Pool | PoolClient, updateId: number): Promise<void> {
  await db.query(
    `UPDATE tanbot_telegram_update_dedup SET reply_delivered_at = NOW() WHERE update_id = $1`,
    [updateId],
  );
}
