import type { Response } from "express";
import { withTransaction } from "../../access/db";
import { setNoStore } from "../../http/no-store";
import type { AccessRequest } from "../../access/middleware";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { requireTanTrackerMutationAccess } from "../guards";
import { mintExternalMessengerSession } from "./session-service";
import { isExternalMessengerFeatureEnabled } from "./config";
import { getAppOrigin } from "../../config";
import { ensurePartyForUserOnWrite } from "../repository";
import { canViewOrder } from "../scope";
import { loadTanTrackerTeamEmployeeGuids } from "../team-scope";
import {
  listRevokedParties,
  listTimelineForTransfer,
  mapTransferToOrderDto,
} from "../repository";
import type { AccessContext } from "../../access/types";

export async function createExternalMessengerInviteHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  if (!isExternalMessengerFeatureEnabled()) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Подтверждение через мессенджеры недоступно."));
    return;
  }
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  try {
    const payload = await withTransaction(async (client) => {
      const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
      const row = await client.query<{
        id: string;
        public_code: string;
        holder_party_id: string;
        pending_party_id: string | null;
        handoff_version: number;
        status: string;
        kind: string;
      }>(
        `SELECT t.id, t.public_code, t.holder_party_id, t.pending_party_id, t.handoff_version, t.status, p.kind
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
      if (t.holder_party_id !== party.id) {
        throw Object.assign(new Error("Приглашение может создать только текущий держатель."), { http: 403 });
      }
      if (!["waiting", "active"].includes(t.status)) {
        throw Object.assign(new Error("Передача недоступна для нового приглашения."), { http: 409 });
      }

      const timeline = await listTimelineForTransfer(client, t.id);
      const revoked = await listRevokedParties(client, t.id);
      const dto = mapTransferToOrderDto(
        (
          await client.query(
            `SELECT id, public_code, item_title, qty_label, comment_text, status,
                    creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
                    due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version,
                    first_custody_at
             FROM tt_transfers WHERE id = $1`,
            [t.id],
          )
        ).rows[0],
        timeline,
        revoked,
      );
      const teamGuids = await loadTanTrackerTeamEmployeeGuids({
        ...access,
        userId: user.id,
        role: user.role as AccessContext["role"],
      });
      const partyMap = new Map<string, string | null>();
      const ctx = {
        userId: user.id,
        role: user.role,
        employeeId: access.employeeId,
        actorPartyId: party.id,
        previewReadOnly: !!access.preview?.readOnly,
      };
      if (!canViewOrder(dto, ctx, [], teamGuids, false, partyMap)) {
        throw Object.assign(new Error("Нет доступа к этой передаче."), { http: 403 });
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
        transferPublicCode: t.public_code,
      };
    });
    setNoStore(res);
    res.status(201).json(payload);
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 500;
    const message = err instanceof Error ? err.message : "Ошибка.";
    setNoStore(res);
    res.status(http).json(
      apiError(
        http === 403 ? ERROR_CODES.FORBIDDEN : http === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR,
        message,
      ),
    );
  }
}
