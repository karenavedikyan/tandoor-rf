import type { PoolClient } from "pg";

type TransferRow = {
  id: string;
  holder_party_id: string;
  pending_party_id: string | null;
  final_recipient_party_id: string | null;
  handoff_version: number;
  row_version: number;
};

/** Move holder → pending (same outcome as successful code verify). */
export async function applyPendingReceiptHandoff(
  client: PoolClient,
  row: TransferRow,
  auditUserId: string | null,
  actingPartyId: string,
  timelineNote: string,
): Promise<void> {
  if (!row.pending_party_id) {
    throw Object.assign(new Error("Нет ожидающего получателя."), { http: 409 });
  }
  const from = row.holder_party_id;
  const to = row.pending_party_id;
  let newStatus = "active";
  const completed = to === row.final_recipient_party_id;
  if (completed) newStatus = "completed";
  await client.query(
    `UPDATE tt_transfers SET holder_party_id = $2, pending_party_id = NULL, status = $3,
            holder_since = NOW(), handoff_version = handoff_version + 1, row_version = row_version + 1,
            completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END
     WHERE id = $1 AND row_version = $4`,
    [row.id, to, newStatus, row.row_version],
  );
  await client.query(
    `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
     VALUES ($1,$2,$3,$4,$5::uuid)`,
    [row.id, from, to, timelineNote, auditUserId],
  );
  if (completed) {
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5::uuid)`,
      [row.id, to, row.final_recipient_party_id, "Доставлено конечному получателю", auditUserId],
    );
  }
  await client.query(
    `UPDATE tt_transfer_invitations SET superseded_at = NOW()
     WHERE transfer_id = $1 AND superseded_at IS NULL`,
    [row.id],
  );
}
