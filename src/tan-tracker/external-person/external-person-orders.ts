import type { Pool } from "pg";
import type { TanTrackerOrderDto, TanTrackerTimelineRow, TanTrackerTransferRow } from "../types";
import { transferIdsWithConfirmedFirstCustodyAudit } from "../custody-state";
import { computeCanDeleteBeforeReceiptDto } from "../registry-cleanup/eligibility";
import { registryCleanupActorFromExternalParty } from "../registry-cleanup/context";
import { listRevokedParties, mapTransferToOrderDto } from "../repository";
import { listAttachmentsForTransfers } from "../attachments";
import { holderAccessTtlMs, signHolderAccess } from "../holder-access";
import { enrichOrdersWithPersonalRecipientLabels } from "../personal-recipient-label";
import { orderParticipantIds } from "../scope";

const OPEN_HOLDER_STATUSES = new Set(["active", "waiting", "delivered"]);

export type ExternalHistoricalSummary = {
  id: string;
  publicCode: string;
  itemTitle: string;
  lastAt: number;
  note: string;
};

const PARTICIPANT_SQL = `t.creator_party_id = $1::uuid
        OR t.holder_party_id = $1::uuid
        OR t.pending_party_id = $1::uuid
        OR t.final_recipient_party_id = $1::uuid`;

/** Full orders where external party is an active participant (not timeline-only). */
export async function loadExternalPersonOrders(
  pool: Pool,
  partyId: string,
): Promise<TanTrackerOrderDto[]> {
  const rows = await pool.query<TanTrackerTransferRow>(
    `SELECT t.* FROM tt_transfers t
     WHERE ${PARTICIPANT_SQL}
     ORDER BY t.updated_at DESC
     LIMIT 100`,
    [partyId],
  );
  const transferIds = rows.rows.map((r) => r.id);
  const auditConfirmedIds = await transferIdsWithConfirmedFirstCustodyAudit(pool, transferIds);
  const deleteActor = registryCleanupActorFromExternalParty(partyId);
  const contactNameByPartyId = new Map<string, string>();
  const orders: TanTrackerOrderDto[] = [];
  for (const row of rows.rows) {
    const timeline = await pool.query<TanTrackerTimelineRow>(
      `SELECT id, transfer_id, from_party_id, to_party_id, note, occurred_at, actor_user_id
       FROM tt_transfer_timeline
       WHERE transfer_id = $1
         AND (from_party_id = $2::uuid OR to_party_id = $2::uuid)
       ORDER BY occurred_at ASC`,
      [row.id, partyId],
    );
    const revoked = await listRevokedParties(pool, row.id);
    const attMap = await listAttachmentsForTransfers(pool, [row.id]);
    const rawAtt = attMap.get(row.id) ?? [];
    const attachments =
      row.from_external && row.creator_party_id === partyId
        ? rawAtt
            .filter((a) => !a.addedBy)
            .map((a) => ({
              id: a.id,
              mimeType: a.mimeType,
              byteSize: a.byteSize,
              name: a.name,
              addedAt: a.addedAt,
              addedBy: a.addedBy,
            }))
        : [];
    const dto = mapTransferToOrderDto(row, timeline.rows, revoked, { attachments });
    dto.hasConfirmedReceipt = row.first_custody_at != null || auditConfirmedIds.has(row.id);
    dto.attachments = attachments;
    dto.timeline = dto.timeline.filter((e) => e.from === partyId || e.to === partyId);
    if (
      row.holder_party_id === partyId &&
      row.status !== "completed" &&
      OPEN_HOLDER_STATUSES.has(row.status)
    ) {
      dto.holderAccessToken = signHolderAccess({
        transferId: row.id,
        partyId,
        hv: row.handoff_version,
        exp: Date.now() + holderAccessTtlMs(),
      });
    }
    dto.canDeleteBeforeReceipt = computeCanDeleteBeforeReceiptDto(
      dto,
      row,
      deleteActor,
      auditConfirmedIds,
    );
    for (const pid of orderParticipantIds(dto as TanTrackerOrderDto)) {
      if (!contactNameByPartyId.has(pid)) {
        const pr = await pool.query<{ display_name: string }>(
          `SELECT display_name FROM tt_parties WHERE id = $1::uuid`,
          [pid],
        );
        contactNameByPartyId.set(pid, pr.rows[0]?.display_name?.trim() || "—");
      }
    }
    await enrichOrdersWithPersonalRecipientLabels(pool, partyId, false, [dto], contactNameByPartyId);
    orders.push(dto);
  }
  return orders;
}

/** Minimal rows for past transfers where party appeared only on timeline (registry history, no file leak). */
export async function loadExternalHistoricalSummaries(
  pool: Pool,
  partyId: string,
): Promise<ExternalHistoricalSummary[]> {
  const res = await pool.query<{
    id: string;
    public_code: string;
    item_title: string;
    note: string;
    occurred_at: Date;
  }>(
    `SELECT t.id, t.public_code, t.item_title, tl.note, tl.occurred_at
     FROM tt_transfer_timeline tl
     JOIN tt_transfers t ON t.id = tl.transfer_id
     WHERE (tl.from_party_id = $1::uuid OR tl.to_party_id = $1::uuid)
       AND NOT (
         t.creator_party_id = $1::uuid
         OR t.holder_party_id = $1::uuid
         OR (t.pending_party_id IS NOT NULL AND t.pending_party_id = $1::uuid)
         OR (t.final_recipient_party_id IS NOT NULL AND t.final_recipient_party_id = $1::uuid)
       )
     ORDER BY tl.occurred_at DESC
     LIMIT 50`,
    [partyId],
  );
  const seen = new Set<string>();
  const out: ExternalHistoricalSummary[] = [];
  for (const row of res.rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({
      id: row.public_code,
      publicCode: row.public_code,
      itemTitle: row.item_title,
      lastAt: row.occurred_at.getTime(),
      note: row.note,
    });
  }
  return out;
}
