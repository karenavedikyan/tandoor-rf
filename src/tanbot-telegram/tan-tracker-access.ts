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

/** Participant or holder check for tan_tracker outbox delivery (no OTP in messages). */
export async function canDeliverTanTrackerOutboxNotification(
  client: PoolClient,
  userId: string,
  transferId: string,
  handoffVersion: number,
  eventType: string,
): Promise<boolean> {
  if (eventType === "tan_tracker.assignment" || eventType === "tan_tracker.code_obtained") {
    return canDeliverAssignmentNotification(client, userId, transferId, handoffVersion);
  }

  const userRow = await client.query<{ status: string; role: string }>(
    `SELECT status, role FROM users WHERE id = $1::uuid`,
    [userId],
  );
  const user = userRow.rows[0];
  if (!user || user.status !== "active") return false;
  if (!tanTrackerNavAllowed(user.role)) return false;

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
    handoff_version: number;
    status: string;
  }>(
    `SELECT creator_party_id::text, holder_party_id::text, pending_party_id::text,
            final_recipient_party_id::text, handoff_version, status
     FROM tt_transfers WHERE id = $1`,
    [transferId],
  );
  const t = row.rows[0];
  if (!t) return false;
  if (t.handoff_version < handoffVersion) return false;
  if (eventType !== "tan_tracker.closed" && t.status === "completed") return false;

  const participates =
    partyId === t.creator_party_id ||
    partyId === t.holder_party_id ||
    partyId === t.pending_party_id ||
    partyId === t.final_recipient_party_id;
  return participates;
}
