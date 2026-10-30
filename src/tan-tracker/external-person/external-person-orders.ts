import type { Pool } from "pg";
import type { TanTrackerOrderDto, TanTrackerTimelineRow, TanTrackerTransferRow } from "../types";
import { listRevokedParties, mapTransferToOrderDto } from "../repository";
import { listAttachmentsForTransfers } from "../attachments";

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
    dto.attachments = attachments;
    dto.timeline = dto.timeline.filter((e) => e.from === partyId || e.to === partyId);
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
         t.creator_party_id = $1::uuid OR t.holder_party_id = $1::uuid
         OR t.pending_party_id = $1::uuid OR t.final_recipient_party_id = $1::uuid
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
