import type { Pool, PoolClient } from "pg";
import { maxReplyExtraFromReply, parseMaxReplyExtra } from "../tanbot/webhook-reply-extra";
import type { WebhookReply } from "./webhook-handler";

export type UpdateClaim =
  | { kind: "process" }
  | { kind: "resend"; reply: WebhookReply }
  | { kind: "ignore" };

export async function claimMaxUpdate(client: PoolClient, dedupKey: string): Promise<UpdateClaim> {
  const inserted = await client.query(
    `INSERT INTO tanbot_max_update_dedup (dedup_key, status)
     VALUES ($1, 'processing')
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING dedup_key`,
    [dedupKey],
  );
  if ((inserted.rowCount ?? 0) > 0) {
    return { kind: "process" };
  }

  const existing = await client.query<{
    status: string;
    reply_chat_id: string | null;
    reply_user_id: string | null;
    reply_text: string | null;
    reply_extra: unknown;
    reply_delivered_at: Date | null;
  }>(
    `SELECT status, reply_chat_id::text, reply_user_id::text, reply_text, reply_extra, reply_delivered_at
     FROM tanbot_max_update_dedup WHERE dedup_key = $1 FOR UPDATE`,
    [dedupKey],
  );
  const row = existing.rows[0];
  if (!row) {
    return { kind: "process" };
  }
  if (row.status === "processing") {
    return { kind: "ignore" };
  }
  if (row.status === "failed") {
    await client.query(`UPDATE tanbot_max_update_dedup SET status = 'processing' WHERE dedup_key = $1`, [dedupKey]);
    return { kind: "process" };
  }
  if (row.reply_delivered_at) {
    return { kind: "ignore" };
  }
  if (row.reply_user_id && row.reply_text) {
    const extra = parseMaxReplyExtra(row.reply_extra);
    return {
      kind: "resend",
      reply: {
        userId: BigInt(row.reply_user_id),
        chatId: row.reply_chat_id ? BigInt(row.reply_chat_id) : BigInt(row.reply_user_id),
        text: row.reply_text,
        inlineButtons: extra.inlineButtons,
        replyExtra: extra,
      },
    };
  }
  return { kind: "ignore" };
}

export async function commitMaxUpdateReply(
  client: PoolClient,
  dedupKey: string,
  reply: WebhookReply,
): Promise<void> {
  if (!reply) {
    await client.query(
      `UPDATE tanbot_max_update_dedup SET status = 'committed', reply_delivered_at = NOW() WHERE dedup_key = $1`,
      [dedupKey],
    );
    return;
  }
  const extra = maxReplyExtraFromReply(reply);
  await client.query(
    `UPDATE tanbot_max_update_dedup
     SET status = 'committed', reply_chat_id = $2, reply_user_id = $3, reply_text = $4, reply_extra = $5::jsonb
     WHERE dedup_key = $1`,
    [
      dedupKey,
      reply.chatId.toString(),
      reply.userId.toString(),
      reply.text,
      extra ? JSON.stringify(extra) : null,
    ],
  );
}

export async function markMaxUpdateFailed(client: PoolClient, dedupKey: string): Promise<void> {
  await client.query(`UPDATE tanbot_max_update_dedup SET status = 'failed' WHERE dedup_key = $1`, [dedupKey]);
}

export async function markMaxReplyDelivered(db: Pool | PoolClient, dedupKey: string): Promise<void> {
  await db.query(`UPDATE tanbot_max_update_dedup SET reply_delivered_at = NOW() WHERE dedup_key = $1`, [dedupKey]);
}

export async function updateMaxReplyExtra(
  db: Pool | PoolClient,
  dedupKey: string,
  extra: Record<string, unknown>,
): Promise<void> {
  await db.query(`UPDATE tanbot_max_update_dedup SET reply_extra = $2::jsonb WHERE dedup_key = $1`, [
    dedupKey,
    JSON.stringify(extra),
  ]);
}
