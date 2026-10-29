import type { Response } from "express";
import { withTransaction } from "../../access/db";
import { setNoStore } from "../../http/no-store";
import type { AccessRequest } from "../../access/middleware";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { requireTanTrackerMutationAccess } from "../guards";
import { mintExternalMessengerSession } from "./session-service";
import { isExternalMessengerFeatureEnabled } from "./config";
import { getAppOrigin } from "../../config";

export async function createExternalMessengerInviteHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  if (!isExternalMessengerFeatureEnabled()) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Подтверждение через мессенджеры недоступно."));
    return;
  }
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  try {
    const payload = await withTransaction(async (client) => {
      const row = await client.query<{
        id: string;
        holder_party_id: string;
        pending_party_id: string | null;
        handoff_version: number;
        status: string;
        kind: string;
      }>(
        `SELECT t.id, t.holder_party_id, t.pending_party_id, t.handoff_version, t.status, p.kind
         FROM tt_transfers t
         LEFT JOIN tt_parties p ON p.id = t.pending_party_id
         WHERE t.id = $1 OR t.public_code = $1
         FOR UPDATE OF t`,
        [transferId],
      );
      const t = row.rows[0];
      if (!t || !t.pending_party_id || t.kind !== "external") {
        throw Object.assign(new Error("Нет внешнего получателя для мессенджера."), { http: 404 });
      }
      if (!["waiting", "active"].includes(t.status)) {
        throw Object.assign(new Error("Передача недоступна для нового приглашения."), { http: 409 });
      }
      const minted = await mintExternalMessengerSession(client, {
        transferId: t.id,
        pendingPartyId: t.pending_party_id,
        handoffVersion: t.handoff_version,
      });
      if (!minted) throw Object.assign(new Error("Не удалось создать приглашение."), { http: 503 });
      const origin = getAppOrigin() ?? "";
      const portalPath = `/tan-tracker/recipient?mst=${encodeURIComponent(minted.startToken)}`;
      return {
        startToken: minted.startToken,
        portalUrl: origin ? `${origin}${portalPath}` : portalPath,
        portalPath,
      };
    });
    setNoStore(res);
    res.status(201).json(payload);
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 500;
    const message = err instanceof Error ? err.message : "Ошибка.";
    setNoStore(res);
    res.status(http).json(apiError(http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR, message));
  }
}
