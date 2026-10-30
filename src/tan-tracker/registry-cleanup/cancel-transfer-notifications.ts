import type { PoolClient } from "pg";

/** Parses canonical tt-ext-msg idempotency keys (internal transfer id segment). */
export function transferInternalIdFromExternalPersonOutboxKey(idempotencyKey: string): string | null {
  const match = /^tt-ext-msg:[^:]+:([^:]+):hv:\d+(?::|$)/.exec(idempotencyKey);
  return match?.[1] ?? null;
}

export async function cancelQueuedNotificationsForTransferDelete(
  client: PoolClient,
  transferInternalId: string,
): Promise<void> {
  await client.query(
    `UPDATE tt_external_person_message_outbox
     SET status = 'cancelled', last_error_code = 'TRANSFER_DELETED'
     WHERE status IN ('pending', 'processing')
       AND idempotency_key LIKE 'tt-ext-msg:%:' || $1 || ':hv:%'`,
    [transferInternalId],
  );

  await client.query(
    `UPDATE tanbot_notification_outbox
     SET status = 'cancelled', last_error_code = 'TRANSFER_DELETED'
     WHERE status IN ('pending', 'processing')
       AND (
         idempotency_key LIKE 'tt-staff:%:' || $1 || ':hv:%'
         OR idempotency_key LIKE 'tt-assignment:' || $1 || ':hv:%'
         OR (event_type LIKE 'tan_tracker.%' AND payload->>'transferId' = $1)
       )`,
    [transferInternalId],
  );
}

export async function transferStillExists(client: PoolClient, transferInternalId: string): Promise<boolean> {
  const row = await client.query(`SELECT 1 FROM tt_transfers WHERE id = $1 LIMIT 1`, [transferInternalId]);
  return (row.rowCount ?? 0) > 0;
}
