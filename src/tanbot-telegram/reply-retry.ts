import type { Pool } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport } from "./delivery-transport";

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
  try {
    await client.query("BEGIN");
    const batch = await client.query<{
      update_id: string;
      reply_chat_id: string;
      reply_text: string;
    }>(
      `SELECT update_id::text, reply_chat_id::text, reply_text
       FROM tanbot_telegram_update_dedup
       WHERE status = 'committed'
         AND reply_text IS NOT NULL
         AND reply_delivered_at IS NULL
       ORDER BY received_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const row of batch.rows) {
      result.attempted += 1;
      const send = await transport({
        method: "sendMessage",
        token: config.botToken,
        body: { chat_id: row.reply_chat_id, text: row.reply_text },
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      });
      if (send.ok) {
        await client.query(
          `UPDATE tanbot_telegram_update_dedup SET reply_delivered_at = NOW() WHERE update_id = $1`,
          [Number(row.update_id)],
        );
        result.delivered += 1;
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
