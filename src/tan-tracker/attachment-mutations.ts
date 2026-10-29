import type { Response } from "express";
import type { PoolClient } from "pg";
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
import type { TanTrackerScopeContext, TanTrackerTransferRow } from "./types";

type AddBody = { stagingAttachmentIds?: string[] };

type DbLike = Pick<PoolClient, "query">;

async function loadOrderDtoFromRow(client: DbLike, row: TanTrackerTransferRow) {
  const id = row.id;
  const timeline = await listTimelineForTransfer(client as PoolClient, id);
  const revoked = await listRevokedParties(client as PoolClient, id);
  const attMap = await listAttachmentsForTransfers(client as PoolClient, [id]);
  return mapTransferToOrderDto(row, timeline, revoked, {
    attachments: attMap.get(id) ?? [],
  });
}

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
  return loadOrderDtoFromRow(pool, row);
}

/** Atomic metadata + blob delete (postgres); used by API and integration tests. */
export async function deleteTransferAttachmentInTransaction(
  client: PoolClient,
  input: {
    transferId: string;
    attId: string;
    actorPartyId: string;
    scopeCtx: TanTrackerScopeContext;
    teamGuids: Set<string> | null;
    partyMap: Awaited<ReturnType<typeof loadPartyEmployeeMap>>;
  },
): Promise<void> {
  const locked = await client.query(
    `SELECT id, public_code, item_title, qty_label, comment_text, status,
            creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
            due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version
     FROM tt_transfers
     WHERE id = $1 OR public_code = $1
     LIMIT 1
     FOR UPDATE`,
    [input.transferId],
  );
  const row = locked.rows[0];
  if (!row) {
    throw Object.assign(new Error("Передача не найдена."), { http: 404 });
  }
  const dto = await loadOrderDtoFromRow(client, row);
  if (
    !canViewOrder(dto, input.scopeCtx, [], input.teamGuids, false, input.partyMap) ||
    dto.holderId !== input.actorPartyId ||
    dto.status === "completed"
  ) {
    throw Object.assign(new Error("Нельзя удалить вложение."), { http: 403 });
  }

  const deleted = (
    await client.query<{ storage_key: string }>(
      `DELETE FROM tt_transfer_attachments
       WHERE id = $1::uuid AND transfer_id = $2
       RETURNING storage_key`,
      [input.attId, dto.id],
    )
  ).rows[0];
  if (!deleted) {
    throw Object.assign(new Error("Вложение не найдено."), { http: 404 });
  }
  await deleteAttachmentBytes(deleted.storage_key, client);
}

/** Atomic holder check + staged link under transfer row lock. */
export async function addTransferAttachmentsInTransaction(
  client: PoolClient,
  input: {
    transferId: string;
    userId: string;
    stagingIds: string[];
    actorPartyId: string;
    scopeCtx: TanTrackerScopeContext;
    teamGuids: Set<string> | null;
    partyMap: Awaited<ReturnType<typeof loadPartyEmployeeMap>>;
  },
): Promise<void> {
  const locked = await client.query(
    `SELECT id, public_code, item_title, qty_label, comment_text, status,
            creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
            due_at, holder_since, handoff_version, allow_legacy_complete, completed_at, row_version
     FROM tt_transfers
     WHERE id = $1 OR public_code = $1
     LIMIT 1
     FOR UPDATE`,
    [input.transferId],
  );
  const row = locked.rows[0];
  if (!row) {
    throw Object.assign(new Error("Передача не найдена."), { http: 404 });
  }
  const dto = await loadOrderDtoFromRow(client, row);
  if (
    !canViewOrder(dto, input.scopeCtx, [], input.teamGuids, false, input.partyMap) ||
    dto.holderId !== input.actorPartyId ||
    dto.status === "completed"
  ) {
    throw Object.assign(new Error("Нельзя прикрепить файлы к этой передаче."), { http: 403 });
  }
  await linkStagedAttachmentsToTransfer(client, input.userId, dto.id, input.stagingIds);
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
      await addTransferAttachmentsInTransaction(client, {
        transferId,
        userId: user.id,
        stagingIds,
        actorPartyId: scope.ctx.actorPartyId!,
        scopeCtx: scope.ctx,
        teamGuids: scope.teamGuids,
        partyMap,
      });
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

  try {
    await withTransaction(async (client) => {
      await deleteTransferAttachmentInTransaction(client, {
        transferId,
        attId,
        actorPartyId: scope.ctx.actorPartyId!,
        scopeCtx: scope.ctx,
        teamGuids: scope.teamGuids,
        partyMap,
      });
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http ?? 503;
    const message = err instanceof Error ? err.message : "Не удалось удалить вложение.";
    setNoStore(res);
    res
      .status(http)
      .json(
        apiError(
          http === 404 ? ERROR_CODES.NOT_FOUND : http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.SERVICE_UNAVAILABLE,
          message,
        ),
      );
    return;
  }

  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
