import type { Pool, PoolClient } from "pg";

export type TransferCustodyRow = {
  id: string;
  status: string;
  creator_party_id: string;
  holder_party_id: string;
  first_custody_at?: Date | null;
};

/** Confirmed custody handoff audit actions (canonical, not timeline text). */
export const FIRST_CUSTODY_AUDIT_ACTIONS = [
  "code_verify_ok",
  "holder_code_verify_ok",
  "qr_confirm",
] as const;

export function isBeforeFirstConfirmedCustody(row: TransferCustodyRow): boolean {
  if (row.status === "completed") return false;
  if (row.first_custody_at != null) return false;
  return true;
}

export async function loadTransferForCustodyCheck(
  client: PoolClient,
  transferId: string,
  forUpdate = false,
): Promise<TransferCustodyRow | undefined> {
  const res = await client.query<TransferCustodyRow>(
    `SELECT id, status, creator_party_id, holder_party_id, first_custody_at
     FROM tt_transfers
     WHERE id = $1 OR public_code = $1
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [transferId],
  );
  return res.rows[0];
}

type Db = Pool | PoolClient;

/** Transfer internal ids with canonical first-custody audit (legacy rows without first_custody_at). */
export async function transferIdsWithConfirmedFirstCustodyAudit(
  client: Db,
  transferIds: string[],
): Promise<Set<string>> {
  if (transferIds.length === 0) return new Set();
  const res = await client.query<{ transfer_id: string }>(
    `SELECT DISTINCT transfer_id FROM tt_audit_log
     WHERE transfer_id = ANY($1::text[]) AND action = ANY($2::text[])`,
    [transferIds, FIRST_CUSTODY_AUDIT_ACTIONS],
  );
  return new Set(res.rows.map((r) => r.transfer_id));
}

export async function transferHasConfirmedFirstCustody(
  client: PoolClient,
  transferId: string,
): Promise<boolean> {
  const row = await loadTransferForCustodyCheck(client, transferId);
  if (!row) return true;
  if (row.first_custody_at != null) return true;
  const audit = await client.query<{ n: number }>(
    `SELECT 1 AS n FROM tt_audit_log
     WHERE transfer_id = $1 AND action = ANY($2::text[])
     LIMIT 1`,
    [transferId, FIRST_CUSTODY_AUDIT_ACTIONS],
  );
  return (audit.rowCount ?? 0) > 0;
}

export async function markFirstCustodyIfUnset(client: PoolClient, transferId: string): Promise<void> {
  await client.query(
    `UPDATE tt_transfers SET first_custody_at = COALESCE(first_custody_at, NOW()) WHERE id = $1`,
    [transferId],
  );
}
