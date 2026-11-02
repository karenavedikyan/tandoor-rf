import type { PoolClient } from "pg";
import { invalidateOpenHandoffArtifacts } from "./handoff-invalidation";
import { transferWriteBlocked } from "./transfer-write-guard";
import { notifyClosed } from "./transfer-lk-notify";
import { notifyExternalPartyAfterHandoff } from "./transfer-external-messenger-notify";

export const OBSOLETE_REASON = "Трек закрыт как неактуальный. Текущая передача отменена; получение по ней не подтверждено.";

/** Caller-bound, versioned cancellation. Never a successful completion or custody handoff. */
export async function markPendingObsoleteInTransaction(
  client: PoolClient,
  input: { transferId: string; actorPartyId: string; auditUserId: string | null;
    expectedRowVersion: number; expectedHandoffVersion: number },
): Promise<void> {
  const row = (await client.query<{
    id: string; public_code: string; item_title: string; status: string;
    holder_party_id: string; creator_party_id: string; pending_party_id: string | null;
    handoff_version: number; row_version: number; deleted_at: Date | null; general_archived_at: Date | null;
  }>("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [input.transferId])).rows[0];
  if (!row || transferWriteBlocked(row) || !["active", "waiting", "delivered"].includes(row.status) ||
    row.holder_party_id !== input.actorPartyId || !row.pending_party_id ||
    row.row_version !== input.expectedRowVersion || row.handoff_version !== input.expectedHandoffVersion) {
    throw Object.assign(new Error("Передача изменилась или недоступна. Ничего не изменено."), { http: 409 });
  }
  const pending = row.pending_party_id, nextVersion = row.handoff_version + 1;
  await invalidateOpenHandoffArtifacts(client, row.id);
  await client.query(
    `UPDATE tt_automatic_receipt_codes SET status='cancelled',encrypted_code=NULL,last_error_code='OBSOLETE'
     WHERE transfer_id=$1 AND status='pending'`, [row.id]);
  await client.query("DELETE FROM tt_bot_receipt_code_entries WHERE transfer_id=$1", [row.id]);
  await client.query(
    `INSERT INTO tt_transfer_revoked_parties(transfer_id,party_id) VALUES($1,$2::uuid) ON CONFLICT DO NOTHING`,
    [row.id, pending]);
  await client.query(
    `UPDATE tt_transfers SET status='obsolete',pending_party_id=NULL,handoff_version=$2,row_version=row_version+1
     WHERE id=$1`, [row.id, nextVersion]);
  await client.query(
    `INSERT INTO tt_transfer_timeline(transfer_id,from_party_id,to_party_id,note,actor_user_id)
     VALUES($1,$2::uuid,$2::uuid,$3,$4::uuid)`, [row.id, row.holder_party_id, OBSOLETE_REASON, input.auditUserId]);
  await client.query(
    `INSERT INTO tt_audit_log(transfer_id,actor_user_id,acting_party_id,action,detail)
     VALUES($1,$2::uuid,$3::uuid,'holder_pending_obsolete',$4::jsonb)`,
    [row.id, input.auditUserId, input.actorPartyId, JSON.stringify({ reason: "obsolete", cancelledPendingPartyId: pending,
      previousHandoffVersion: row.handoff_version, handoffVersion: nextVersion })]);
  await notifyClosed(client, {
    transferId: row.id, publicCode: row.public_code, itemTitle: row.item_title,
    holderPartyId: row.holder_party_id, partyIds: [row.holder_party_id, row.creator_party_id],
    handoffVersion: nextVersion,
  });
  for (const partyId of new Set([row.holder_party_id, row.creator_party_id])) {
    await notifyExternalPartyAfterHandoff(client, {
      externalPartyId: partyId, transferId: row.id, handoffVersion: nextVersion, event: "closed",
    });
  }
}
