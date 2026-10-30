import type { Pool, PoolClient } from "pg";

export type HolderAccessPayload = {
  transferId: string;
  partyId: string;
  hv: number;
  exp: number;
};

export type HolderAccessBindingRow = {
  id: string;
  status: string;
  holder_party_id: string;
  handoff_version: number;
  completed_at: Date | null;
};

type Db = Pool | PoolClient;

const OPEN_HOLDER_STATUSES = new Set(["active", "waiting", "delivered"]);

export async function loadOpenHolderAccessBinding(
  db: Db,
  access: HolderAccessPayload,
): Promise<HolderAccessBindingRow | null> {
  const res = await db.query<HolderAccessBindingRow>(
    `SELECT id, status, holder_party_id, handoff_version, completed_at
     FROM tt_transfers
     WHERE id = $1
       AND holder_party_id = $2::uuid
       AND handoff_version = $3
       AND completed_at IS NULL
       AND status = ANY($4::text[])
     LIMIT 1`,
    [access.transferId, access.partyId, access.hv, [...OPEN_HOLDER_STATUSES]],
  );
  return res.rows[0] ?? null;
}
