import type { PoolClient } from "pg";

export type TransferCustodyRow = {
  id: string;
  status: string;
  creator_party_id: string;
  holder_party_id: string;
};

/** True while the creating holder still physically holds the item (no confirmed receipt yet). */
export function isBeforeFirstConfirmedCustody(row: TransferCustodyRow): boolean {
  if (row.status === "completed") return false;
  return row.creator_party_id === row.holder_party_id;
}

export async function loadTransferForCustodyCheck(
  client: PoolClient,
  transferId: string,
  forUpdate = false,
): Promise<TransferCustodyRow | undefined> {
  const res = await client.query<TransferCustodyRow>(
    `SELECT id, status, creator_party_id, holder_party_id
     FROM tt_transfers
     WHERE id = $1 OR public_code = $1
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [transferId],
  );
  return res.rows[0];
}
