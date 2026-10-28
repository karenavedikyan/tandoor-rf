import type { Request, Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { getPool } from "../db/pool";
import {
  generateNumericOtp,
  hashOtp,
  PhoneVerificationUnavailableError,
  resolvePhoneVerificationProvider,
  storeTestPhoneVerificationCode,
} from "./phone-verification";
import { requireHandoffOtpPepper } from "./otp-config";
import {
  PHONE_SEND_COOLDOWN_MS,
  PHONE_SEND_MAX_PER_WINDOW,
  PHONE_SEND_WINDOW_MS,
  PHONE_VERIFICATION_MAX_ATTEMPTS,
  PHONE_VERIFICATION_TTL_MS,
  PHONE_SESSION_TTL_MS,
} from "./otp-config";
import { verifyInvitationToken } from "./invitation-token";
import { signPhoneSession, verifyPhoneSession } from "./phone-session";
import { applyPendingReceiptHandoff } from "./handoff-complete";

type InviteBody = {
  invitationToken?: string;
  transferId?: string;
  hv?: number;
  pendingPartyId?: string;
};

async function resolveInvitation(body: InviteBody) {
  if (body.invitationToken) {
    return verifyInvitationToken(body.invitationToken);
  }
  if (body.transferId && body.pendingPartyId && body.hv != null) {
    return {
      transferId: String(body.transferId),
      hv: Number(body.hv),
      pendingPartyId: String(body.pendingPartyId),
      exp: Date.now() + 1,
    };
  }
  return null;
}

async function loadOpenInvitation(
  client: { query: Function },
  transferId: string,
  hv: number,
  pendingPartyId: string,
) {
  const row = (
    await client.query(
      `SELECT t.id, t.status, t.holder_party_id, t.pending_party_id, t.final_recipient_party_id,
              t.handoff_version, t.row_version, p.phone_e164
       FROM tt_transfers t
       JOIN tt_parties p ON p.id = t.pending_party_id
       JOIN tt_transfer_invitations inv
         ON inv.transfer_id = t.id AND inv.handoff_version = t.handoff_version AND inv.superseded_at IS NULL
       WHERE (t.id = $1 OR t.public_code = $1)
         AND t.handoff_version = $2
         AND t.pending_party_id = $3::uuid
         AND inv.pending_party_id = $3::uuid
       LIMIT 1 FOR UPDATE`,
      [transferId, hv, pendingPartyId],
    )
  ).rows[0] as
    | {
        id: string;
        status: string;
        holder_party_id: string;
        pending_party_id: string;
        final_recipient_party_id: string | null;
        handoff_version: number;
        row_version: number;
        phone_e164: string | null;
      }
    | undefined;
  return row;
}

export async function publicSendPhoneCodeHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as InviteBody;
  const invite = await resolveInvitation(body);
  if (!invite) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректное приглашение."));
    return;
  }
  let provider;
  try {
    provider = resolvePhoneVerificationProvider();
    requireHandoffOtpPepper();
  } catch (err) {
    if (err instanceof PhoneVerificationUnavailableError) {
      setNoStore(res);
      res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, err.message));
      return;
    }
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }

  try {
    await withTransaction(async (client) => {
      const row = await loadOpenInvitation(client, invite.transferId, invite.hv, invite.pendingPartyId);
      if (!row || row.status === "completed" || !row.phone_e164) {
        throw Object.assign(new Error("Приглашение недоступно."), { http: 404 });
      }
      const sendStats = (
        await client.query<{ cnt: string; last_at: Date | null }>(
          `SELECT COUNT(*)::text AS cnt, MAX(created_at) AS last_at
           FROM tt_phone_verifications
           WHERE transfer_id = $1 AND party_id = $2::uuid
             AND created_at > NOW() - ($3::bigint * interval '1 millisecond')`,
          [row.id, invite.pendingPartyId, PHONE_SEND_WINDOW_MS],
        )
      ).rows[0];
      if (Number(sendStats?.cnt ?? 0) >= PHONE_SEND_MAX_PER_WINDOW) {
        throw Object.assign(new Error("Слишком много запросов кода. Попробуйте позже."), { http: 429 });
      }
      if (sendStats?.last_at && Date.now() - sendStats.last_at.getTime() < PHONE_SEND_COOLDOWN_MS) {
        throw Object.assign(new Error("Подождите перед повторной отправкой кода."), { http: 429 });
      }
      const code = generateNumericOtp(6);
      const pepper = requireHandoffOtpPepper();
      const hash = hashOtp(code, pepper);
      const expiresAt = new Date(Date.now() + PHONE_VERIFICATION_TTL_MS);
      await client.query(
        `UPDATE tt_phone_verifications SET verified_at = NOW()
         WHERE transfer_id = $1 AND party_id = $2::uuid AND verified_at IS NULL`,
        [row.id, invite.pendingPartyId],
      );
      await client.query(
        `INSERT INTO tt_phone_verifications (transfer_id, party_id, handoff_version, code_hash, expires_at, attempt_count)
         VALUES ($1,$2::uuid,$3,$4,$5,0)`,
        [row.id, invite.pendingPartyId, row.handoff_version, hash, expiresAt],
      );
      storeTestPhoneVerificationCode(row.id, invite.pendingPartyId, code);
      await provider.sendCode({
        phoneE164: row.phone_e164,
        transferId: row.id,
        partyId: invite.pendingPartyId,
      });
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 503;
    const message = err instanceof Error ? err.message : "Не удалось отправить код.";
    setNoStore(res);
    res
      .status(http)
      .json(
        apiError(
          http === 404 ? ERROR_CODES.NOT_FOUND : http === 429 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.SERVICE_UNAVAILABLE,
          message,
        ),
      );
    return;
  }

  setNoStore(res);
  res.status(200).json({ ok: true });
}

type VerifyOutcome =
  | { kind: "ok"; token: string }
  | { kind: "wrong"; blocked: boolean }
  | { kind: "fail"; http: number; message: string };

export async function publicVerifyPhoneCodeHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as InviteBody & { code?: string };
  const invite = await resolveInvitation(body);
  const rawCode = String(body.code ?? "").replace(/\D/g, "");
  if (!invite || rawCode.length !== 6) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные данные."));
    return;
  }
  let pepper: string;
  try {
    pepper = requireHandoffOtpPepper();
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }

  let outcome: VerifyOutcome | undefined;
  try {
    await withTransaction(async (client) => {
      const row = await loadOpenInvitation(client, invite.transferId, invite.hv, invite.pendingPartyId);
      if (!row || row.status === "completed") {
        outcome = { kind: "fail", http: 404, message: "Приглашение недоступно." };
        return;
      }
      const ver = (
        await client.query<{
          id: string;
          code_hash: string;
          expires_at: Date;
          attempt_count: number;
        }>(
          `SELECT id, code_hash, expires_at, attempt_count FROM tt_phone_verifications
           WHERE transfer_id = $1 AND party_id = $2::uuid AND verified_at IS NULL
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [row.id, invite.pendingPartyId],
        )
      ).rows[0];
      if (!ver) {
        outcome = { kind: "fail", http: 409, message: "Сначала запросите код подтверждения." };
        return;
      }
      if (ver.expires_at.getTime() <= Date.now()) {
        await client.query(`UPDATE tt_phone_verifications SET verified_at = NOW() WHERE id = $1`, [ver.id]);
        outcome = { kind: "fail", http: 409, message: "Срок кода истёк. Запросите новый." };
        return;
      }
      if (ver.attempt_count >= PHONE_VERIFICATION_MAX_ATTEMPTS) {
        await client.query(`UPDATE tt_phone_verifications SET verified_at = NOW() WHERE id = $1`, [ver.id]);
        outcome = { kind: "fail", http: 409, message: "Превышено число попыток." };
        return;
      }
      const hash = hashOtp(rawCode, pepper);
      if (hash !== ver.code_hash) {
        const attempts = ver.attempt_count + 1;
        await client.query(`UPDATE tt_phone_verifications SET attempt_count = $2 WHERE id = $1`, [ver.id, attempts]);
        if (attempts >= PHONE_VERIFICATION_MAX_ATTEMPTS) {
          await client.query(`UPDATE tt_phone_verifications SET verified_at = NOW() WHERE id = $1`, [ver.id]);
        }
        outcome = { kind: "wrong", blocked: attempts >= PHONE_VERIFICATION_MAX_ATTEMPTS };
        return;
      }
      await client.query(`UPDATE tt_phone_verifications SET verified_at = NOW() WHERE id = $1`, [ver.id]);
      outcome = {
        kind: "ok",
        token: signPhoneSession({
          transferId: row.id,
          partyId: invite.pendingPartyId,
          hv: row.handoff_version,
          exp: Date.now() + PHONE_SESSION_TTL_MS,
        }),
      };
    });
  } catch {
    outcome = { kind: "fail", http: 503, message: "Не удалось подтвердить номер." };
  }

  const finalOutcome: VerifyOutcome =
    outcome ?? { kind: "fail", http: 503, message: "Не удалось подтвердить номер." };

  setNoStore(res);
  if (finalOutcome.kind === "ok") {
    res.status(200).json({ ok: true, phoneSessionToken: finalOutcome.token });
    return;
  }
  if (finalOutcome.kind === "wrong") {
    res.status(400).json(
      apiError(
        ERROR_CODES.VALIDATION_ERROR,
        finalOutcome.blocked ? "Превышено число попыток. Запросите новый код." : "Неверный код.",
      ),
    );
    return;
  }
  res.status(finalOutcome.http).json(apiError(ERROR_CODES.VALIDATION_ERROR, finalOutcome.message));
}

export async function publicConfirmQrHandoffHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as InviteBody & { phoneSessionToken?: string };
  const invite = await resolveInvitation(body);
  const session = body.phoneSessionToken ? verifyPhoneSession(body.phoneSessionToken) : null;
  if (!invite || !session) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Подтвердите номер телефона."));
    return;
  }
  if (session.partyId !== invite.pendingPartyId || session.hv !== invite.hv) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия подтверждения недействительна."));
    return;
  }

  try {
    await withTransaction(async (client) => {
      const row = await loadOpenInvitation(client, invite.transferId, invite.hv, invite.pendingPartyId);
      if (!row || row.status === "completed") {
        throw Object.assign(new Error("Приглашение недоступно."), { http: 404 });
      }
      if (row.id !== session.transferId) {
        throw Object.assign(new Error(" Сессия подтверждения недействительна."), { http: 403 });
      }
      await applyPendingReceiptHandoff(
        client,
        row,
        null,
        invite.pendingPartyId,
        "Подтверждено по QR",
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,NULL,$2::uuid,'qr_confirm','{}'::jsonb)`,
        [row.id, invite.pendingPartyId],
      );
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 503;
    const message = err instanceof Error ? err.message : "Не удалось подтвердить получение.";
    setNoStore(res);
    res
      .status(http)
      .json(apiError(http === 403 ? ERROR_CODES.FORBIDDEN : http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.SERVICE_UNAVAILABLE, message));
    return;
  }

  setNoStore(res);
  res.status(200).json({ ok: true });
}

/** Authenticated holder refresh after public QR confirm (optional poll). */
export async function publicInvitationStatusHandler(req: Request, res: Response): Promise<void> {
  const transferId = String(req.params.id ?? "").trim();
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База недоступна."));
    return;
  }
  const row = (
    await pool.query(
      `SELECT public_code, status, handoff_version, pending_party_id::text AS pending_party_id
       FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1`,
      [transferId],
    )
  ).rows[0];
  if (!row) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Не найдено."));
    return;
  }
  setNoStore(res);
  res.status(200).json({
    id: row.public_code,
    status: row.status,
    handoffVersion: row.handoff_version,
    pendingPartyId: row.pending_party_id,
  });
}
