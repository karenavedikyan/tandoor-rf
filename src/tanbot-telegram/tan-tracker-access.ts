import type { PoolClient } from "pg";

/** Minimal scope check before sending assignment notification (no public tokens). */
export async function canUserViewTransfer(
  client: PoolClient,
  userId: string,
  transferId: string,
): Promise<boolean> {
  const party = await client.query<{ id: string }>(
    `SELECT id::text FROM tt_parties WHERE user_id = $1::uuid AND kind = 'user' LIMIT 1`,
    [userId],
  );
  const partyId = party.rows[0]?.id;
  if (!partyId) return false;

  const row = await client.query<{
    creator_party_id: string;
    holder_party_id: string;
    pending_party_id: string | null;
    final_recipient_party_id: string | null;
  }>(
    `SELECT creator_party_id::text, holder_party_id::text, pending_party_id::text, final_recipient_party_id::text
     FROM tt_transfers WHERE id = $1`,
    [transferId],
  );
  const t = row.rows[0];
  if (!t) return false;
  const involved = [t.creator_party_id, t.holder_party_id, t.pending_party_id, t.final_recipient_party_id].filter(
    Boolean,
  ) as string[];
  return involved.includes(partyId);
}
