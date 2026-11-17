import type { PoolClient } from "pg";
import type { ReceiptTarget } from "./automatic-receipt-target";

export type ReceiptAccountDelivery = {
  id: string; job_id: string; delivery_epoch: string; generation: number; channel: "max" | "telegram";
  messenger_user_id: string; messenger_chat_id: string; phone_snapshot: string | null;
  status: string; header_sent_at: Date | null; attempt_count: number; next_attempt_at: Date;
};
export async function createReceiptAccountDeliveries(
  c: PoolClient, jobId: string, targets: ReceiptTarget[],
) {
  await c.query("UPDATE tt_automatic_receipt_codes SET delivery_epoch=COALESCE(delivery_epoch,gen_random_uuid()) WHERE id=$1", [jobId]);
  for (const target of targets) {
    await c.query(`INSERT INTO tt_automatic_receipt_account_deliveries
      (job_id,delivery_epoch,generation,channel,messenger_user_id,messenger_chat_id,phone_snapshot)
      SELECT id,delivery_epoch,generation,$2,$3,$4,$5 FROM tt_automatic_receipt_codes
      WHERE id=$1 ON CONFLICT DO NOTHING`,
    [jobId,target.channel,target.userId,target.chatId,target.phone]);
  }
}
export async function renewReceiptAccountDeliveries(c: PoolClient, jobId: string) {
  // Preserve the original snapshots. Never silently deliver an old invitation to a new binding.
  await c.query(`INSERT INTO tt_automatic_receipt_account_deliveries
    (job_id,delivery_epoch,generation,channel,messenger_user_id,messenger_chat_id,phone_snapshot)
    SELECT d.job_id,j.delivery_epoch,j.generation,d.channel,d.messenger_user_id,d.messenger_chat_id,d.phone_snapshot
    FROM tt_automatic_receipt_account_deliveries d JOIN tt_automatic_receipt_codes j ON j.id=d.job_id
    WHERE d.job_id=$1 AND d.delivery_epoch=j.delivery_epoch AND d.generation=j.generation-1 ON CONFLICT DO NOTHING`, [jobId]);
}
export async function finishReceiptAccountBatch(c: PoolClient, jobId: string, generation: number) {
  const r = (await c.query<{ pending: number; sent: number; failed: number }>(`SELECT
    COUNT(*) FILTER(WHERE status='pending')::int AS pending,
    COUNT(*) FILTER(WHERE status='sent')::int AS sent,
    COUNT(*) FILTER(WHERE status='failed')::int AS failed
    FROM tt_automatic_receipt_account_deliveries WHERE job_id=$1 AND generation=$2
    AND delivery_epoch=(SELECT delivery_epoch FROM tt_automatic_receipt_codes WHERE id=$1)`, [jobId,generation])).rows[0]!;
  if (r.pending) return;
  await c.query(`UPDATE tt_automatic_receipt_codes SET status=$2,
    sent_at=CASE WHEN $3>0 THEN NOW() ELSE sent_at END,
    encrypted_code=CASE WHEN $4>0 THEN encrypted_code ELSE NULL END WHERE id=$1`,
  [jobId,r.sent ? "sent" : r.failed ? "failed" : "cancelled",r.sent,r.failed]);
}
