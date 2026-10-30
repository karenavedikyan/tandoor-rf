import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export async function staffUserAcceptsExternalIntake(client: Db, userId: string): Promise<boolean> {
  const row = await client.query<{ ok: boolean }>(
    `SELECT accepts_external_tt_intake AS ok FROM users WHERE id = $1::uuid AND status = 'active' LIMIT 1`,
    [userId],
  );
  return row.rows[0]?.ok === true;
}

/** Prior legitimate transfer relationship between external party and staff user party. */
export async function hasPriorTransferRelationship(
  client: Db,
  externalPartyId: string,
  staffUserId: string,
): Promise<boolean> {
  const staffParty = await client.query<{ id: string }>(
    `SELECT id::text FROM tt_parties WHERE user_id = $1::uuid LIMIT 1`,
    [staffUserId],
  );
  const staffPartyId = staffParty.rows[0]?.id;
  if (!staffPartyId) return false;
  const res = await client.query<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM tt_transfers t
     WHERE (
       (t.creator_party_id = $1::uuid AND (t.holder_party_id = $2::uuid OR t.pending_party_id = $2::uuid OR t.final_recipient_party_id = $2::uuid))
       OR (t.creator_party_id = $2::uuid AND (t.holder_party_id = $1::uuid OR t.pending_party_id = $1::uuid OR t.final_recipient_party_id = $1::uuid))
       OR EXISTS (
         SELECT 1 FROM tt_transfer_timeline tl
         WHERE tl.transfer_id = t.id AND (tl.from_party_id = $1::uuid OR tl.to_party_id = $1::uuid)
           AND (tl.from_party_id = $2::uuid OR tl.to_party_id = $2::uuid)
       )
     )
     LIMIT 1`,
    [externalPartyId, staffPartyId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function countOpenExternalRequests(client: Db, externalPartyId: string): Promise<number> {
  const row = await client.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM tt_transfers t
     WHERE t.from_external = TRUE
       AND t.creator_party_id = $1::uuid
       AND t.external_declined_at IS NULL
       AND t.status IN ('active', 'waiting', 'delivered')`,
    [externalPartyId],
  );
  return row.rows[0]?.c ?? 0;
}

export const MAX_OPEN_EXTERNAL_REQUESTS = 5;
