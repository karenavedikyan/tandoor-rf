import type { PoolClient } from "pg";

/**
 * Explicit operator repair, never called by a request handler or a worker.
 * Caller owns BEGIN/COMMIT. No messages, user/profile edits or history merges.
 * All inputs must be established by a read-only investigation beforehand.
 */
export async function repairConflictingExternalProof(
  c: PoolClient,
  input: {
    publicCode: string; expectedPhone: string; channel: "max" | "telegram";
    incorrectMessengerUserId: string; confirmedMessengerUserId: string; actorUserId: string;
  },
): Promise<Record<string, number>> {
  if (input.incorrectMessengerUserId === input.confirmedMessengerUserId) throw Error("SAME_IDENTITY");
  // Fails before any mutation if an operator forgot the enclosing transaction.
  await c.query("SAVEPOINT tt_identity_conflict_repair");
  const actor = await c.query("SELECT 1 FROM users WHERE id=$1 AND role='admin' AND status='active'", [input.actorUserId]);
  if (!actor.rowCount) throw Error("ACTIVE_ADMIN_REQUIRED");
  const row = (await c.query<{
    id: string; pending_party_id: string; holder_party_id: string; handoff_version: number; item_title: string; person_id: string;
  }>(
    `SELECT t.id,t.pending_party_id,t.holder_party_id,t.handoff_version,t.item_title,ep.id AS person_id
     FROM tt_transfers t JOIN tt_parties p ON p.id=t.pending_party_id
     JOIN tt_external_persons ep ON ep.party_id=p.id AND ep.phone_e164=p.phone_e164
     WHERE t.public_code=$1 AND p.kind='external' AND ep.phone_e164=$2
       AND t.status IN ('waiting','active') AND t.deleted_at IS NULL AND t.general_archived_at IS NULL
     FOR UPDATE OF t,ep`,
    [input.publicCode, input.expectedPhone],
  )).rows[0];
  if (!row) throw Error("EXPECTED_OPEN_EXTERNAL_TRANSFER_REQUIRED");
  // Same lock namespace/order as the delivery worker, after the transfer lock.
  await c.query("SELECT id FROM tt_automatic_receipt_codes WHERE pending_party_id=$1 ORDER BY id FOR UPDATE", [row.pending_party_id]);
  for (const messengerId of [input.incorrectMessengerUserId, input.confirmedMessengerUserId].sort()) {
    await c.query("SELECT pg_advisory_xact_lock($1,hashtext($2::text))",
      [input.channel === "max" ? 845012 : 845011, messengerId]);
  }
  await c.query("SELECT pg_advisory_xact_lock(845020,hashtext($1::text))", [input.expectedPhone]);
  const prefix = input.channel;
  const proofs = (await c.query<{
    id: string; messenger_user_id: string; messenger_chat_id: string; staff_phone: string | null; staff_id: string | null;
    verification_snapshot: Record<string, unknown>; staff_status: string | null;
  }>(
    `SELECT v.id,v.messenger_user_id,v.messenger_chat_id,to_jsonb(v) AS verification_snapshot,
       u.phone AS staff_phone,u.status AS staff_status,a.user_id AS staff_id
     FROM tt_external_person_verifications v
     LEFT JOIN tanbot_${prefix}_accounts a ON a.${prefix}_user_id::text=v.messenger_user_id
       AND a.${prefix}_chat_id::text=v.messenger_chat_id
     LEFT JOIN users u ON u.id=a.user_id
     WHERE v.person_id=$1 AND v.channel=$2 ORDER BY v.id FOR UPDATE OF v`,
    [row.person_id, input.channel],
  )).rows;
  const incorrect = proofs.find(v => v.messenger_user_id === input.incorrectMessengerUserId);
  const confirmed = proofs.find(v => v.messenger_user_id === input.confirmedMessengerUserId);
  if (proofs.length !== 2 || !incorrect || !confirmed || !incorrect.staff_id || !confirmed.staff_id ||
      incorrect.staff_id === confirmed.staff_id || !incorrect.staff_phone || incorrect.staff_phone === input.expectedPhone ||
      confirmed.staff_status !== "active" ||
      (confirmed.staff_phone !== null && confirmed.staff_phone !== input.expectedPhone)) {
    throw Error("EXPECTED_TWO_PROOFS_AND_DISTINCT_STAFF_OWNERS_REQUIRED");
  }
  const count: Record<string, number> = {};
  const update = async (key: string, sql: string, args: unknown[]) => {
    count[key] = (await c.query(sql, args)).rowCount ?? 0;
  };
  // Record the removed proof in the audit, not in a public report or a new identity.
  await update("audit", `INSERT INTO tt_audit_log(transfer_id,actor_user_id,action,detail)
    VALUES($1,$2,'external_identity_conflict_repaired',$3::jsonb)`,
    [row.id, input.actorUserId, JSON.stringify({ removedProof: incorrect.verification_snapshot, retainedProofId: confirmed.id,
      oldHandoffVersion: row.handoff_version, channel: input.channel })]);
  await update("removedProofs", "DELETE FROM tt_external_person_verifications WHERE id=$1", [incorrect.id]);
  if (count.removedProofs !== 1) throw Error("EXPECTED_ONE_REMOVED_PROOF");
  await update("revokedSessions", `UPDATE tt_external_person_sessions SET revoked_at=NOW()
    WHERE person_id=$1 AND revoked_at IS NULL`, [row.person_id]);
  await update("rotatedEpoch", "UPDATE tt_external_persons SET access_epoch=access_epoch+1,updated_at=NOW() WHERE id=$1", [row.person_id]);
  await update("expiredCodes", `UPDATE tt_handoff_codes SET expires_at=LEAST(expires_at,NOW())
    WHERE pending_party_id=$1 AND consumed_at IS NULL`, [row.pending_party_id]);
  await update("cancelledAutomaticCodes", `UPDATE tt_automatic_receipt_codes
    SET status='cancelled',encrypted_code=NULL,code_hash=NULL,code_expires_at=NULL,last_error_code='IDENTITY_CONFLICT_REPAIRED'
    WHERE pending_party_id=$1 AND status<>'cancelled'`, [row.pending_party_id]);
  await update("cancelledExternalMessages", `UPDATE tt_external_person_message_outbox
    SET status='cancelled',last_error_code='IDENTITY_CONFLICT_REPAIRED'
    WHERE person_id=$1 AND status IN ('pending','processing')`, [row.person_id]);
  await update("supersededBotSessions", `UPDATE tt_external_messenger_sessions SET superseded_at=NOW()
    WHERE pending_party_id=$1 AND superseded_at IS NULL`, [row.pending_party_id]);
  await update("supersededInvitations", `UPDATE tt_transfer_invitations SET superseded_at=NOW()
    WHERE transfer_id=$1 AND superseded_at IS NULL`, [row.id]);
  await update("rotatedTransferVersion", `UPDATE tt_transfers
    SET handoff_version=handoff_version+1,row_version=row_version+1,updated_at=NOW() WHERE id=$1`, [row.id]);
  await update("newInvitation", `INSERT INTO tt_transfer_invitations
    (transfer_id,handoff_version,holder_party_id,pending_party_id,item_snapshot)
    VALUES($1,$2,$3,$4,$5)`, [row.id, row.handoff_version+1, row.holder_party_id, row.pending_party_id, row.item_title]);
  await c.query("RELEASE SAVEPOINT tt_identity_conflict_repair");
  return count;
}
