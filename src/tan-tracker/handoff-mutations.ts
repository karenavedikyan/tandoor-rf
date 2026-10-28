import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { buildTanTrackerBootstrap } from "./service";
import { ensurePartyForUserOnWrite } from "./repository";
import { generateNumericOtp, hashOtp } from "./phone-verification";
import { requireTanTrackerMutationAccess } from "./guards";
import {
  HANDOFF_CODE_MAX_VERIFY_ATTEMPTS,
  HANDOFF_CODE_TTL_MS,
  requireHandoffOtpPepper,
} from "./otp-config";
import { applyPendingReceiptHandoff } from "./handoff-complete";

async function loadTransfer(client: { query: Function }, id: string) {
  const res = await client.query(
    `SELECT id, status, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version
     FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1 FOR UPDATE`,
    [id],
  );
  return res.rows[0] as
    | {
        id: string;
        status: string;
        holder_party_id: string;
        pending_party_id: string | null;
        final_recipient_party_id: string | null;
        handoff_version: number;
        row_version: number;
      }
    | undefined;
}

export async function generateHandoffCodeHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);
  let pepper: string;
  try {
    pepper = requireHandoffOtpPepper();
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис кодов временно недоступен."));
    return;
  }

  type GenResult =
    | { ok: true; code: string; expiresAt: number; transferId: string }
    | { ok: false; http: number; message: string };

  let payload: GenResult;
  try {
    payload = await withTransaction(async (client) => {
      const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
      const row = await loadTransfer(client, transferId);
      if (!row || !row.pending_party_id) {
        return { ok: false, http: 404, message: "Передача не найдена." };
      }
      if (row.pending_party_id !== party.id) {
        return {
          ok: false,
          http: 403,
          message: "Только ожидающий получатель может выпустить код.",
        };
      }
      const code = generateNumericOtp(6);
      const hash = hashOtp(code, pepper);
      const expiresAt = new Date(Date.now() + HANDOFF_CODE_TTL_MS);
      await client.query(
        `UPDATE tt_handoff_codes SET consumed_at = NOW()
         WHERE transfer_id = $1 AND handoff_version = $2 AND consumed_at IS NULL`,
        [row.id, row.handoff_version],
      );
      await client.query(
        `INSERT INTO tt_handoff_codes (transfer_id, handoff_version, pending_party_id, code_hash, expires_at, verify_attempt_count)
         VALUES ($1,$2,$3,$4,$5,0)`,
        [row.id, row.handoff_version, row.pending_party_id, hash, expiresAt],
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,$2::uuid,$3,'code_generate','{}'::jsonb)`,
        [row.id, auditUserId, party.id],
      );
      return { ok: true, code, expiresAt: expiresAt.getTime(), transferId: row.id };
    });
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось выпустить код."));
    return;
  }

  if (!payload.ok) {
    setNoStore(res);
    res
      .status(payload.http)
      .json(
        apiError(
          payload.http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.NOT_FOUND,
          payload.message,
        ),
      );
    return;
  }

  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ...payload, bootstrap });
}

export async function verifyHandoffCodeHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const rawCode = String((req.body as { code?: string })?.code ?? "").replace(/\D/g, "");
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);

  if (rawCode.length !== 6) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Введите 6-значный код."));
    return;
  }

  let pepper: string;
  try {
    pepper = requireHandoffOtpPepper();
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис кодов временно недоступен."));
    return;
  }

  type VerifyResult =
    | { ok: true }
    | { ok: false; http: number; message: string };

  let result: VerifyResult;
  try {
    result = await withTransaction(async (client) => {
      const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
      const row = await loadTransfer(client, transferId);
      if (!row || !row.pending_party_id) {
        return { ok: false, http: 404, message: "Передача не найдена." };
      }
      if (row.holder_party_id !== party.id) {
        return { ok: false, http: 403, message: "Подтверждать код может только текущий держатель." };
      }
      const codeRes = await client.query<{
        id: string;
        code_hash: string;
        expires_at: Date;
        verify_attempt_count: number;
      }>(
        `SELECT id, code_hash, expires_at, verify_attempt_count FROM tt_handoff_codes
         WHERE transfer_id = $1 AND handoff_version = $2 AND pending_party_id = $3 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [row.id, row.handoff_version, row.pending_party_id],
      );
      const codeRow = codeRes.rows[0];
      if (!codeRow) {
        return { ok: false, http: 409, message: "Код не выпущен или истёк." };
      }
      if (codeRow.expires_at.getTime() <= Date.now()) {
        await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
        return { ok: false, http: 409, message: "Срок кода истёк. Получатель должен выпустить новый код." };
      }
      if (codeRow.verify_attempt_count >= HANDOFF_CODE_MAX_VERIFY_ATTEMPTS) {
        await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
        return {
          ok: false,
          http: 409,
          message: "Превышено число попыток. Получатель должен выпустить новый код.",
        };
      }

      const hash = hashOtp(rawCode, pepper);
      if (hash !== codeRow.code_hash) {
        const attempts = codeRow.verify_attempt_count + 1;
        await client.query(`UPDATE tt_handoff_codes SET verify_attempt_count = $2 WHERE id = $1`, [
          codeRow.id,
          attempts,
        ]);
        await client.query(
          `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
           VALUES ($1,$2::uuid,$3,'code_verify_fail',$4::jsonb)`,
          [row.id, auditUserId, party.id, JSON.stringify({ attempts })],
        );
        if (attempts >= HANDOFF_CODE_MAX_VERIFY_ATTEMPTS) {
          await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
          return {
            ok: false,
            http: 409,
            message: "Превышено число попыток. Получатель должен выпустить новый код.",
          };
        }
        return { ok: false, http: 400, message: "Неверный код. Текущий держатель не изменился." };
      }

      await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
      await applyPendingReceiptHandoff(
        client,
        row,
        auditUserId,
        party.id,
        "Подтверждено одноразовым кодом",
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,$2::uuid,$3,'code_verify_ok','{}'::jsonb)`,
        [row.id, auditUserId, party.id],
      );
      return { ok: true };
    });
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось подтвердить код."));
    return;
  }

  if (!result.ok) {
    setNoStore(res);
    res
      .status(result.http)
      .json(
        apiError(
          result.http === 403
            ? ERROR_CODES.FORBIDDEN
            : result.http === 404
              ? ERROR_CODES.NOT_FOUND
              : ERROR_CODES.VALIDATION_ERROR,
          result.message,
        ),
      );
    return;
  }

  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
