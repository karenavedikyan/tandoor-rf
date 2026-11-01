import type { PoolClient } from "pg";
import { hashOtp } from "./phone-verification";
import { requireHandoffOtpPepper, HANDOFF_CODE_MAX_VERIFY_ATTEMPTS } from "./otp-config";
import { applyPendingReceiptHandoff } from "./handoff-complete";
import { transferWriteBlocked } from "./transfer-write-guard";

export type LockedReceiptTransfer = {
  id: string; holder_party_id: string; pending_party_id: string | null;
  final_recipient_party_id: string | null; handoff_version: number; row_version: number;
  deleted_at?: Date | null; general_archived_at?: Date | null;
};
export type ReceiptCodeResult = { ok: true } | { ok: false; http: number; message: string };

/** Caller locks the transfer and authenticates its holder. Incorrect OTPs RETURN, not throw:
 * the enclosing transaction must commit attempt counters and audit records. */
export async function verifyPendingReceiptCode(
  client: PoolClient,
  input: {
    row: LockedReceiptTransfer; code: string; auditUserId: string | null; actingPartyId: string; pepper?: string;
    /** True when the code was entered in a bot whose reply already reports the outcome to the actor. */
    botReply?: boolean;
  },
): Promise<ReceiptCodeResult> {
  const { row } = input;
  if (transferWriteBlocked(row) || row.holder_party_id !== input.actingPartyId || !row.pending_party_id) {
    return { ok: false, http: 409, message: "Передача недоступна для подтверждения." };
  }
  if (!/^\d{6}$/.test(input.code)) return { ok: false, http: 400, message: "Укажите 6-значный код." };
  let pepper: string;
  try { pepper = input.pepper ?? requireHandoffOtpPepper(); }
  catch { return { ok: false, http: 503, message: "Сервис кодов временно недоступен." }; }
  const codes = await client.query<{
    id: string; code_hash: string; expires_at: Date; verify_attempt_count: number;
  }>(
    `SELECT id, code_hash, expires_at, verify_attempt_count FROM tt_handoff_codes
     WHERE transfer_id=$1 AND handoff_version=$2 AND pending_party_id=$3 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [row.id, row.handoff_version, row.pending_party_id],
  );
  const codeRow = codes.rows[0];
  if (!codeRow) return { ok: false, http: 409, message: "Код не выпущен или истёк." };
  const maxAttemptsMessage = "Превышено число попыток. Получатель должен выпустить новый код.";
  if (codeRow.expires_at.getTime() <= Date.now()) {
    await client.query(`UPDATE tt_handoff_codes SET consumed_at=NOW() WHERE id=$1`, [codeRow.id]);
    return { ok: false, http: 409, message: "Срок кода истёк. Получатель должен выпустить новый код." };
  }
  if (codeRow.verify_attempt_count >= HANDOFF_CODE_MAX_VERIFY_ATTEMPTS) {
    await client.query(`UPDATE tt_handoff_codes SET consumed_at=NOW() WHERE id=$1`, [codeRow.id]);
    return { ok: false, http: 409, message: maxAttemptsMessage };
  }
  if (hashOtp(input.code, pepper) !== codeRow.code_hash) {
    const attempts = codeRow.verify_attempt_count + 1;
    await client.query(`UPDATE tt_handoff_codes SET verify_attempt_count=$2 WHERE id=$1`, [codeRow.id, attempts]);
    await client.query(
      `INSERT INTO tt_audit_log (transfer_id,actor_user_id,acting_party_id,action,detail)
       VALUES($1,$2::uuid,$3::uuid,'code_verify_fail',$4::jsonb)`,
      [row.id, input.auditUserId, input.actingPartyId, JSON.stringify({ attempts })],
    );
    if (attempts >= HANDOFF_CODE_MAX_VERIFY_ATTEMPTS) {
      await client.query(`UPDATE tt_handoff_codes SET consumed_at=NOW() WHERE id=$1`, [codeRow.id]);
      return { ok: false, http: 409, message: maxAttemptsMessage };
    }
    return { ok: false, http: 400, message: "Неверный код. Текущий держатель не изменился." };
  }
  await client.query(`UPDATE tt_handoff_codes SET consumed_at=NOW() WHERE id=$1`, [codeRow.id]);
  await applyPendingReceiptHandoff(client, row, input.auditUserId, input.actingPartyId, "Подтверждено одноразовым кодом", {
    botActor: input.botReply ? { staffUserId: input.auditUserId, partyId: input.actingPartyId } : null,
  });
  await client.query(
    `INSERT INTO tt_audit_log (transfer_id,actor_user_id,acting_party_id,action,detail)
     VALUES($1,$2::uuid,$3::uuid,'code_verify_ok','{}'::jsonb)`,
    [row.id, input.auditUserId, input.actingPartyId],
  );
  return { ok: true };
}
