import type { Pool } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport } from "./delivery-transport";
import { parseTelegramReplyExtra } from "../tanbot/webhook-reply-extra";
import { deliverTelegramWebhookReply } from "./webhook-reply-delivery";

export type TelegramReplyRetryResult = { attempted: number; delivered: number };

export async function processUndeliveredTelegramWebhookReplies(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport,
  options: { limit?: number; deliveryEnabled?: boolean } = {},
): Promise<TelegramReplyRetryResult> {
  const limit = options.limit ?? 20;
  const deliveryEnabled = options.deliveryEnabled ?? config.deliveryEnabled;
  const result: TelegramReplyRetryResult = { attempted: 0, delivered: 0 };
  if (!deliveryEnabled) return result;

  const client = await pool.connect();
  let rows: Array<{
    update_id: string;
    reply_chat_id: string;
    reply_text: string;
    reply_extra: unknown;
  }> = [];
  try {
    await client.query("BEGIN");
    const batch = await client.query<{
      update_id: string;
      reply_chat_id: string;
      reply_text: string;
      reply_extra: unknown;
    }>(
      `SELECT update_id::text, reply_chat_id::text, reply_text, reply_extra
       FROM tanbot_telegram_update_dedup
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
    const extra = parseTelegramReplyExtra(row.reply_extra);
    const send = await deliverTelegramWebhookReply(pool, config, transport, Number(row.update_id), {
      chatId: BigInt(row.reply_chat_id),
      text: row.reply_text,
      replyMarkup: extra.replyMarkup,
      answerCallbackQueryId: extra.answerCallbackQueryId,
      replyExtra: extra,
    });
    if (send?.ok) {
      result.delivered += 1;
    }
  }
  return result;
}
