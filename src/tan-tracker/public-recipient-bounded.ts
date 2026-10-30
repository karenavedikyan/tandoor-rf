import type { Pool } from "pg";
import type { InvitationTokenPayload } from "./invitation-token";
import { listRevokedParties, listTimelineForTransfer, mapTransferToOrderDto, partyToContact } from "./repository";
import { listAttachmentsForTransfers } from "./attachments";

const MAX_TIMELINE = 40;
const MAX_ATTACHMENTS = 20;

/** Read-only bounded order snapshot for public recipient after handoff (receipt reload). */
export async function loadBoundedPublicRecipientOrder(
  pool: Pool,
  input: { transferId: string; recipientPartyId: string },
) {
  const row = (
    await pool.query(
      `SELECT t.id, t.public_code, t.item_title, t.qty_label, t.comment_text, t.status,
              t.creator_party_id, t.holder_party_id, t.pending_party_id, t.final_recipient_party_id,
              t.due_at, t.holder_since, t.handoff_version, t.allow_legacy_complete, t.completed_at, t.row_version,
              t.delivered_at
       FROM tt_transfers t
       WHERE (t.id = $1 OR t.public_code = $1)
         AND t.holder_party_id = $2::uuid
       LIMIT 1`,
      [input.transferId, input.recipientPartyId],
    )
  ).rows[0];
  if (!row) return null;

  const timeline = (await listTimelineForTransfer(pool, row.id)).slice(-MAX_TIMELINE);
  const revoked = await listRevokedParties(pool, row.id);
  const attMap = await listAttachmentsForTransfers(pool, [row.id]);
  const attachments = (attMap.get(row.id) ?? []).slice(0, MAX_ATTACHMENTS);
  const dto = mapTransferToOrderDto(row, timeline, revoked, { attachments });
  dto.attachments = (dto.attachments ?? []).map((a) => ({ ...a, url: undefined }));

  const partyIds = [
    row.holder_party_id,
    row.creator_party_id,
    row.final_recipient_party_id,
  ].filter(Boolean);
  const parties = await pool.query(
    `SELECT p.id, p.kind, p.user_id, p.display_name, p.phone_e164, NULL::text AS linked_employee_id
     FROM tt_parties p WHERE p.id = ANY($1::uuid[])`,
    [partyIds],
  );
  const contacts = parties.rows.map(partyToContact);

  return { row, dto, contacts };
}

export function recipientMayRefreshAfterReceipt(invite: InvitationTokenPayload, holderPartyId: string): boolean {
  return holderPartyId === invite.pendingPartyId;
}
