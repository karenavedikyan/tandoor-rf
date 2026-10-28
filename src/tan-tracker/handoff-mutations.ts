import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId, resolveTanTrackerEffectiveUser } from "./effective-user";
import { buildTanTrackerBootstrap } from "./service";
import { ensurePartyForUserOnWrite } from "./repository";
import { generateNumericOtp, hashOtp } from "./phone-verification";

const CODE_TTL_MS = 15 * 60 * 1000;

function otpPepper(): string {
  return process.env.TT_OTP_PEPPER || "dev-only-pepper";
}

async function loadTransfer(client: { query: Function }, id: string) {
  const res = await client.query(
    `SELECT id, status, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version
     FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1`,
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
      }
    | undefined;
}

export async function generateHandoffCodeHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!req.authUser || !req.accessContext) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }
  if (req.accessContext.preview?.readOnly) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Изменения запрещены в режиме просмотра."));
    return;
  }
  const user = resolveTanTrackerEffectiveUser(req.authUser, req.accessContext);
  const transferId = String(req.params.id ?? "");
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser, req.accessContext);

  const payload = await withTransaction(async (client) => {
    const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
    const row = await loadTransfer(client, transferId);
    if (!row || !row.pending_party_id) {
      throw Object.assign(new Error("NOT_FOUND"), { http: 404 });
    }
    if (row.pending_party_id !== party.id) {
      throw Object.assign(new Error("FORBIDDEN"), { http: 403 });
    }
    const code = generateNumericOtp(6);
    const hash = hashOtp(code, otpPepper());
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await client.query(
      `UPDATE tt_handoff_codes SET consumed_at = NOW()
       WHERE transfer_id = $1 AND handoff_version = $2 AND consumed_at IS NULL`,
      [row.id, row.handoff_version],
    );
    await client.query(
      `INSERT INTO tt_handoff_codes (transfer_id, handoff_version, pending_party_id, code_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [row.id, row.handoff_version, row.pending_party_id, hash, expiresAt],
    );
    await client.query(
      `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
       VALUES ($1,$2::uuid,$3,'code_generate','{}'::jsonb)`,
      [row.id, auditUserId, party.id],
    );
    return { code, expiresAt: expiresAt.getTime(), transferId: row.id };
  }).catch((err: { http?: number }) => {
    if (err.http === 404) {
      setNoStore(res);
      res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Передача не найдена."));
      return null;
    }
    if (err.http === 403) {
      setNoStore(res);
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Только ожидающий получатель может выпустить код."));
      return null;
    }
    throw err;
  });

  if (!payload) return;
  const bootstrap = await buildTanTrackerBootstrap(req.authUser, req.accessContext);
  setNoStore(res);
  res.status(200).json({ ...payload, bootstrap });
}

export async function verifyHandoffCodeHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!req.authUser || !req.accessContext) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }
  if (req.accessContext.preview?.readOnly) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Изменения запрещены в режиме просмотра."));
    return;
  }
  const user = resolveTanTrackerEffectiveUser(req.authUser, req.accessContext);
  const transferId = String(req.params.id ?? "");
  const rawCode = String((req.body as { code?: string })?.code ?? "").replace(/\D/g, "");
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser, req.accessContext);

  if (rawCode.length !== 6) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Введите 6-значный код."));
    return;
  }

  const ok = await withTransaction(async (client) => {
    const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
    const row = await loadTransfer(client, transferId);
    if (!row || !row.pending_party_id) {
      throw Object.assign(new Error("NOT_FOUND"), { http: 404 });
    }
    if (row.holder_party_id !== party.id) {
      throw Object.assign(new Error("FORBIDDEN"), { http: 403 });
    }
    const codeRes = await client.query<{
      id: string;
      code_hash: string;
      expires_at: Date;
    }>(
      `SELECT id, code_hash, expires_at FROM tt_handoff_codes
       WHERE transfer_id = $1 AND handoff_version = $2 AND pending_party_id = $3 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [row.id, row.handoff_version, row.pending_party_id],
    );
    const codeRow = codeRes.rows[0];
    if (!codeRow) {
      throw Object.assign(new Error("NO_CODE"), { http: 409 });
    }
    if (codeRow.expires_at.getTime() <= Date.now()) {
      throw Object.assign(new Error("EXPIRED"), { http: 409 });
    }
    const hash = hashOtp(rawCode, otpPepper());
    if (hash !== codeRow.code_hash) {
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,$2::uuid,$3,'code_verify_fail','{}'::jsonb)`,
        [row.id, auditUserId, party.id],
      );
      throw Object.assign(new Error("BAD_CODE"), { http: 400 });
    }
    await client.query(`UPDATE tt_handoff_codes SET consumed_at = NOW() WHERE id = $1`, [codeRow.id]);
    const from = row.holder_party_id;
    const to = row.pending_party_id;
    let newStatus = "active";
    let completed = false;
    if (to === row.final_recipient_party_id) {
      newStatus = "completed";
      completed = true;
    }
    await client.query(
      `UPDATE tt_transfers SET holder_party_id = $2, pending_party_id = NULL, status = $3,
              holder_since = NOW(), handoff_version = handoff_version + 1, row_version = row_version + 1,
              completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END
       WHERE id = $1`,
      [row.id, to, newStatus],
    );
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5::uuid)`,
      [row.id, from, to, "Подтверждено одноразовым кодом", auditUserId],
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
    return true;
  }).catch((err: { http?: number; message?: string }) => {
    if (err.http === 404) {
      setNoStore(res);
      res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Передача не найдена."));
      return false;
    }
    if (err.http === 403) {
      setNoStore(res);
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Подтверждать код может только текущий держатель."));
      return false;
    }
    if (err.http === 409) {
      setNoStore(res);
      res.status(409).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Код не выпущен или истёк."));
      return false;
    }
    if (err.http === 400) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Неверный код."));
      return false;
    }
    throw err;
  });

  if (!ok) return;
  const bootstrap = await buildTanTrackerBootstrap(req.authUser, req.accessContext);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
