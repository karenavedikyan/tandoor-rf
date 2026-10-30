import type { Pool } from "pg";
import type { TanTrackerOrderDto, TanTrackerTimelineRow, TanTrackerTransferRow } from "../types";
import { listRevokedParties, mapTransferToOrderDto } from "../repository";
import { listAttachmentsForTransfers } from "../attachments";

/** Limited visibility for verified external persons — no broad timeline participation leak. */
export async function loadExternalPersonOrders(
  pool: Pool,
  partyId: string,
): Promise<TanTrackerOrderDto[]> {
  const rows = await pool.query<TanTrackerTransferRow>(
    `SELECT t.* FROM tt_transfers t
     WHERE t.creator_party_id = $1::uuid
        OR t.holder_party_id = $1::uuid
        OR t.pending_party_id = $1::uuid
        OR t.final_recipient_party_id = $1::uuid
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
        ? rawAtt.map((a) => ({
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
