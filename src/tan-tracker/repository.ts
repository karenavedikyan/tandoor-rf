import type { Pool, PoolClient } from "pg";
import type {
  TanTrackerContactDto,
  TanTrackerOrderDto,
  TanTrackerPartyRow,
  TanTrackerTimelineRow,
  TanTrackerTransferRow,
} from "./types";

export async function ensurePartyForUser(
  client: Pool | PoolClient,
  userId: string,
  displayName: string,
  phoneE164: string | null,
): Promise<TanTrackerPartyRow> {
  const existing = await client.query<TanTrackerPartyRow>(
    `SELECT id, kind, user_id, display_name, phone_e164
     FROM tt_parties WHERE user_id = $1`,
    [userId],
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }
  const inserted = await client.query<TanTrackerPartyRow>(
    `INSERT INTO tt_parties (kind, user_id, display_name, phone_e164, created_by_user_id)
     VALUES ('user', $1, $2, $3, $1)
     RETURNING id, kind, user_id, display_name, phone_e164`,
    [userId, displayName, phoneE164],
  );
  return inserted.rows[0];
}

export async function listAllTransfers(client: Pool | PoolClient): Promise<TanTrackerTransferRow[]> {
  const res = await client.query<TanTrackerTransferRow>(
    `SELECT id, public_code, item_title, qty_label, comment_text, status,
            creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
            due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version
     FROM tt_transfers
     ORDER BY updated_at DESC`,
  );
  return res.rows;
}

export async function listTimelineForTransfer(
  client: Pool | PoolClient,
  transferId: string,
): Promise<TanTrackerTimelineRow[]> {
  const res = await client.query<TanTrackerTimelineRow>(
    `SELECT id, transfer_id, occurred_at, from_party_id, to_party_id, note
     FROM tt_transfer_timeline
     WHERE transfer_id = $1
     ORDER BY occurred_at ASC`,
    [transferId],
  );
  return res.rows;
}

export async function listParties(client: Pool | PoolClient): Promise<TanTrackerPartyRow[]> {
  const res = await client.query<TanTrackerPartyRow>(
    `SELECT id, kind, user_id, display_name, phone_e164 FROM tt_parties`,
  );
  return res.rows;
}

export async function listRevokedParties(
  client: Pool | PoolClient,
  transferId: string,
): Promise<string[]> {
  const res = await client.query<{ party_id: string }>(
    `SELECT party_id FROM tt_transfer_revoked_parties WHERE transfer_id = $1`,
    [transferId],
  );
  return res.rows.map((r) => r.party_id);
}

export function partyToContact(row: TanTrackerPartyRow): TanTrackerContactDto {
  return {
    id: row.id,
    name: row.display_name,
    phone: row.phone_e164 ? row.phone_e164.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7$1$2$3$4") : "",
    employeeId: row.user_id,
  };
}

export function mapTransferToOrderDto(
  row: TanTrackerTransferRow,
  timeline: TanTrackerTimelineRow[],
  revoked: string[],
): TanTrackerOrderDto {
  return {
    id: row.public_code,
    item: row.item_title,
    qty: row.qty_label ?? undefined,
    holderId: row.holder_party_id,
    pendingId: row.pending_party_id,
    status: row.status,
    dueAt: row.due_at ? row.due_at.getTime() : null,
    comment: row.comment_text ?? "",
    holderSince: row.holder_since.getTime(),
    timeline: timeline.map((t) => ({
      at: t.occurred_at.getTime(),
      from: t.from_party_id,
      to: t.to_party_id,
      note: t.note,
    })),
    finalRecipientId: row.final_recipient_party_id,
    createdById: row.creator_party_id,
    allowLegacyComplete: row.allow_legacy_complete,
    handoffVer: row.handoff_version,
    revokedParticipants: revoked,
  };
}
