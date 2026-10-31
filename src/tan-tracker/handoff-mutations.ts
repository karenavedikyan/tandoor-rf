import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { buildTanTrackerBootstrap } from "./service";
import { ensurePartyForUserOnWrite } from "./repository";
import { requireTanTrackerMutationAccess } from "./guards";
import { requireHandoffOtpPepper } from "./otp-config";
import { generateHandoffCodeForPendingParty } from "./handoff-code-generate";
import { verifyPendingReceiptCode } from "./verify-pending-receipt-code";
import { transferWriteBlocked, TRANSFER_WRITE_BLOCKED_MESSAGE } from "./transfer-write-guard";

async function loadTransfer(client: { query: Function }, id: string) {
  const res = await client.query(
    `SELECT id, status, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version,
            deleted_at, general_archived_at
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
        deleted_at: Date | null;
        general_archived_at: Date | null;
      }
    | undefined;
}

export async function generateHandoffCodeHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);

  type GenResult =
    | { ok: true; code: string; expiresAt: number; transferId: string }
    | { ok: false; http: number; message: string };

  let payload: GenResult;
  try {
    payload = await withTransaction(async (client) => {
      const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
      const generated = await generateHandoffCodeForPendingParty(client, {
        transferIdOrCode: transferId,
        pendingPartyId: party.id,
        auditUserId,
        auditPartyId: party.id,
        auditAction: "code_generate",
      });
      if (!generated.ok) {
        return generated;
      }
      return {
        ok: true,
        code: generated.code,
        expiresAt: generated.expiresAt,
        transferId: generated.transferId,
      };
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
      if (!row || transferWriteBlocked(row)) {
        return {
          ok: false,
          http: transferWriteBlocked(row) ? 403 : 404,
          message: transferWriteBlocked(row) ? TRANSFER_WRITE_BLOCKED_MESSAGE : "Передача не найдена.",
        };
      }
      if (!row.pending_party_id) {
        return { ok: false, http: 404, message: "Передача не найдена." };
      }
      if (row.holder_party_id !== party.id) {
        return { ok: false, http: 403, message: "Подтверждать код может только текущий держатель." };
      }
      return verifyPendingReceiptCode(client, {
        row, code: rawCode, auditUserId, actingPartyId: party.id, pepper,
      });
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
