import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { withTransaction } from "../access/db";
import { getPool } from "../db/pool";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";
import {
  deleteAttachmentBytes,
  linkStagedAttachmentsToTransfer,
  listAttachmentsForTransfers,
} from "./attachments";
import { canViewOrder } from "./scope";
import { loadPartyEmployeeMap } from "./party-employee-map";
import { loadTanTrackerTeamEmployeeGuids } from "./team-scope";
import {
  findPartyByUserId,
  listRevokedParties,
  listTimelineForTransfer,
  mapTransferToOrderDto,
} from "./repository";
import type { AccessContext } from "../access/types";
import type { TanTrackerScopeContext } from "./types";

type AddBody = { stagingAttachmentIds?: string[] };

async function loadOrderDto(transferId: string) {
  const pool = getPool();
  if (!pool) return null;
  const row = (
    await pool.query(
      `SELECT id, public_code, item_title, qty_label, comment_text, status,
              creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
              due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version
       FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1`,
      [transferId],
    )
  ).rows[0];
  if (!row) return null;
  const timeline = await listTimelineForTransfer(pool, row.id);
  const revoked = await listRevokedParties(pool, row.id);
  const attMap = await listAttachmentsForTransfers(pool, [row.id]);
  return mapTransferToOrderDto(row, timeline, revoked, {
    attachments: attMap.get(row.id) ?? [],
  });
}

async function holderScope(
  user: { id: string; role: string },
  access: AccessContext,
): Promise<{ ctx: TanTrackerScopeContext; teamGuids: Set<string> | null } | null> {
  const pool = getPool();
  if (!pool) return null;
  const party = await findPartyByUserId(pool, user.id);
  const teamGuids = await loadTanTrackerTeamEmployeeGuids({ ...access, userId: user.id, role: user.role as AccessContext["role"] });
  return {
    ctx: {
      userId: user.id,
      role: user.role,
      employeeId: access.employeeId,
      actorPartyId: party?.id ?? null,
      previewReadOnly: !!access.preview?.readOnly,
    },
    teamGuids,
  };
}

export async function addTransferAttachmentsHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim();
  const body = req.body as AddBody;
  const stagingRaw = Array.isArray(body.stagingAttachmentIds)
    ? body.stagingAttachmentIds.map(String).filter(Boolean)
    : [];
  if (stagingRaw.length > 10) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Не более 10 файлов на передачу."));
    return;
  }
  const stagingIds = stagingRaw;
  if (!stagingIds.length) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите файлы для прикрепления."));
    return;
  }

  const dto = await loadOrderDto(transferId);
  if (!dto) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Передача не найдена."));
    return;
  }

  const scope = await holderScope(user, access);
  if (!scope) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
    return;
  }
  const partyMap = await loadPartyEmployeeMap(getPool()!, []);
  if (
    !canViewOrder(dto, scope.ctx, [], scope.teamGuids, false, partyMap) ||
    dto.holderId !== scope.ctx.actorPartyId ||
    dto.status === "completed"
  ) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нельзя прикрепить файлы к этой передаче."));
    return;
  }

  try {
    await withTransaction(async (client) => {
      await linkStagedAttachmentsToTransfer(client, user.id, dto.id, stagingIds);
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http;
    const message = err instanceof Error ? err.message : "Не удалось прикрепить файлы.";
    setNoStore(res);
    res
      .status(http === 400 ? 400 : 403)
      .json(apiError(http === 400 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.FORBIDDEN, message));
    return;
  }

  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}

export async function deleteTransferAttachmentHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim();
  const attId = String(req.params.attId ?? "").trim();

  const dto = await loadOrderDto(transferId);
  if (!dto) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Передача не найдена."));
    return;
  }

  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
    return;
  }

  const scope = await holderScope(user, access);
  if (!scope) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
    return;
  }
  const partyMap = await loadPartyEmployeeMap(pool, []);
  if (
    !canViewOrder(dto, scope.ctx, [], scope.teamGuids, false, partyMap) ||
    dto.holderId !== scope.ctx.actorPartyId ||
    dto.status === "completed"
  ) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нельзя удалить вложение."));
    return;
  }

  const row = (
    await pool.query<{ storage_key: string }>(
      `DELETE FROM tt_transfer_attachments
       WHERE id = $1::uuid AND transfer_id = $2
       RETURNING storage_key`,
      [attId, dto.id],
    )
  ).rows[0];
  if (!row) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Вложение не найдено."));
    return;
  }

  await deleteAttachmentBytes(row.storage_key, pool);

  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
