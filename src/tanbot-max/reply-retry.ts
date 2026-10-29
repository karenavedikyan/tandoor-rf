import type { Pool } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport } from "./delivery-transport";

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
  try {
    await client.query("BEGIN");
    const batch = await client.query<{
      dedup_key: string;
      reply_user_id: string;
      reply_text: string;
    }>(
      `SELECT dedup_key, reply_user_id::text, reply_text
       FROM tanbot_max_update_dedup
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
        token: config.botToken,
        userId: BigInt(row.reply_user_id),
        text: row.reply_text,
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      });
      if (send.ok) {
        await client.query(
          `UPDATE tanbot_max_update_dedup SET reply_delivered_at = NOW() WHERE dedup_key = $1`,
          [row.dedup_key],
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
