import type { PoolClient } from "pg";
import { tanTrackerNavAllowed } from "../tan-tracker/scope";

/** Delivery-time check: active LK user, still holder at handoff version, canonical TT access. */
export async function canDeliverAssignmentNotification(
  client: PoolClient,
  userId: string,
  transferId: string,
  handoffVersion: number,
): Promise<boolean> {
  const userRow = await client.query<{ status: string; role: string }>(
    `SELECT status, role FROM users WHERE id = $1::uuid`,
    [userId],
  );
  const user = userRow.rows[0];
  if (!user || user.status !== "active") return false;
  if (!tanTrackerNavAllowed(user.role)) return false;
  if (user.role === "admin") return false;

  const party = await client.query<{ id: string }>(
    `SELECT id::text FROM tt_parties WHERE user_id = $1::uuid AND kind = 'user' LIMIT 1`,
    [userId],
  );
  const partyId = party.rows[0]?.id;
  if (!partyId) return false;

  const row = await client.query<{
    holder_party_id: string;
    handoff_version: number;
    status: string;
  }>(`SELECT holder_party_id::text, handoff_version, status FROM tt_transfers WHERE id = $1`, [transferId]);
  const t = row.rows[0];
  if (!t || t.status === "completed") return false;
  if (t.holder_party_id !== partyId) return false;
  if (t.handoff_version < handoffVersion) return false;

  return true;
}
