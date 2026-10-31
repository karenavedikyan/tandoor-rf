import type { Pool } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport } from "./delivery-transport";
import { parseMaxReplyExtra } from "../tanbot/webhook-reply-extra";
import { deliverMaxWebhookReply } from "./webhook-reply-delivery";

export type MaxReplyRetryResult = { attempted: number; delivered: number };

export async function processUndeliveredMaxWebhookReplies(
  pool: Pool,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  options: { limit?: number; deliveryEnabled?: boolean } = {},
): Promise<MaxReplyRetryResult> {
  const limit = options.limit ?? 20;
  const deliveryEnabled = options.deliveryEnabled ?? config.deliveryEnabled;
  const result: MaxReplyRetryResult = { attempted: 0, delivered: 0 };
  if (!deliveryEnabled) return result;

  const client = await pool.connect();
  let rows: Array<{
    dedup_key: string;
    reply_user_id: string;
    reply_chat_id: string | null;
    reply_text: string;
    reply_extra: unknown;
  }> = [];
  try {
    await client.query("BEGIN");
    const batch = await client.query<{
      dedup_key: string;
      reply_user_id: string;
      reply_chat_id: string | null;
      reply_text: string;
      reply_extra: unknown;
    }>(
      `SELECT dedup_key, reply_user_id::text, reply_chat_id::text, reply_text, reply_extra
       FROM tanbot_max_update_dedup
       WHERE status = 'committed'
         AND reply_text IS NOT NULL
         AND reply_delivered_at IS NULL
       ORDER BY received_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    rows = batch.rows;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  for (const row of rows) {
    result.attempted += 1;
    const extra = parseMaxReplyExtra(row.reply_extra);
    const chatId = row.reply_chat_id ? BigInt(row.reply_chat_id) : BigInt(row.reply_user_id);
    const send = await deliverMaxWebhookReply(pool, config, transport, row.dedup_key, {
      userId: BigInt(row.reply_user_id),
      chatId,
      text: row.reply_text,
      inlineButtons: extra.inlineButtons,
    });
    if (send?.ok) {
      result.delivered += 1;
    }
  }
  return result;
}
