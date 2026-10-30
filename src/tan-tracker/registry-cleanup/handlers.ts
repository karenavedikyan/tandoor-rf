import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { withTransaction } from "../../access/db";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { findPartyByUserId, listAllTransferRows, listRevokedParties, listTimelineForTransfer, mapTransferToOrderDto } from "../repository";
import { canViewOrder } from "../scope";
import { loadPartyEmployeeMap } from "../party-employee-map";
import { loadTanTrackerTeamEmployeeGuids } from "../team-scope";
import type { AccessContext } from "../../access/types";
import type { TanTrackerContactDto, TanTrackerOrderDto } from "../types";
import {
  registryCleanupActorFromAccess,
  registryCleanupActorFromExternalParty,
  scopeContextFromActor,
  type RegistryCleanupActor,
} from "./context";
import {
  canDeleteOrder,
  canGeneralArchiveOrder,
  canGeneralRestoreOrder,
  canPersonalArchiveOrder,
  canPersonalHideOrder,
  actorSeesOrder,
  type CleanupMode,
} from "./eligibility";
import { setPersonalArchived, setPersonalHidden } from "./personal-flags";
import { deleteTransferBeforeFirstCustody } from "./delete-transfer";
import type { Request } from "express";
import { resolveExternalPersonAuth } from "../external-person/resolve-auth";
import { loadExternalPersonOrders } from "../external-person/external-person-orders";

type CleanupBody = {
  action?: CleanupMode;
  transferIds?: string[];
  reason?: string;
  deleteAck?: string;
  allAck?: boolean;
};

async function resolveTransferInternalId(client: import("pg").PoolClient, ref: string): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM tt_transfers WHERE deleted_at IS NULL AND (id = $1 OR public_code = $1) LIMIT 1`,
    [ref],
  );
  return res.rows[0]?.id ?? null;
}

async function buildOrderContext(actor: RegistryCleanupActor, access: AccessContext | null) {
  const pool = getPool();
  if (!pool) throw new Error("no pool");
  const teamGuids = access ? await loadTanTrackerTeamEmployeeGuids(access) : new Set<string>();
  const transfers = await listAllTransferRows(pool);
  const partyEmployeeMap = new Map<string, string | null>();
  const orders: Array<{ row: (typeof transfers)[0]; dto: TanTrackerOrderDto }> = [];
  const ctx = scopeContextFromActor(actor);
  for (const row of transfers) {
    const timeline = await listTimelineForTransfer(pool, row.id);
    const revoked = await listRevokedParties(pool, row.id);
    const dto = mapTransferToOrderDto(row, timeline, revoked);
    orders.push({ row, dto });
    partyEmployeeMap.set(row.holder_party_id, null);
  }
  return { orders, ctx, teamGuids, partyEmployeeMap, contacts: [] as TanTrackerContactDto[] };
}

async function runCleanup(
  actor: RegistryCleanupActor,
  body: CleanupBody,
  access: AccessContext | null,
  allowedPublicCodes: Set<string> | null,
): Promise<{ applied: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const action = body.action;
  const ids = Array.isArray(body.transferIds) ? body.transferIds.map(String).filter(Boolean) : [];
  if (!action || !ids.length) {
    throw new Error("VALIDATION");
  }
  if (action === "delete" && body.deleteAck !== "УДАЛИТЬ") {
    throw new Error("DELETE_ACK");
  }
  const { orders, ctx, teamGuids, partyEmployeeMap, contacts } = await buildOrderContext(actor, access);
  const applied: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  await withTransaction(async (client) => {
    for (const ref of ids) {
      const internalId = await resolveTransferInternalId(client, ref);
      if (!internalId) {
        skipped.push({ id: ref, reason: "Не найдена." });
        continue;
      }
      const bundle = orders.find((o) => o.row.id === internalId || o.dto.id === ref);
      if (!bundle) {
        skipped.push({ id: ref, reason: "Нет доступа." });
        continue;
      }
      if (allowedPublicCodes && !allowedPublicCodes.has(bundle.dto.id)) {
        skipped.push({ id: ref, reason: "Нет доступа." });
        continue;
      }
      const { row, dto } = bundle;
      const pub = dto.id;
      const seesOrder =
        allowedPublicCodes != null
          ? allowedPublicCodes.has(pub)
          : actorSeesOrder(dto, actor, ctx, contacts, teamGuids, partyEmployeeMap);
      if (!seesOrder) {
        skipped.push({ id: pub, reason: "Нет доступа." });
        continue;
      }
      if (action === "personal") {
        const ok = canPersonalArchiveOrder(dto, actor, ctx, contacts, teamGuids, partyEmployeeMap, !!row.general_archived_at, false);
        if (!ok) {
          skipped.push({ id: pub, reason: "Нельзя архивировать." });
          continue;
        }
        await setPersonalArchived(client, actor.partyId, [internalId], true);
        applied.push(pub);
      } else if (action === "personal-restore") {
        await setPersonalArchived(client, actor.partyId, [internalId], false);
        applied.push(pub);
      } else if (action === "personal-hide") {
        if (!canPersonalHideOrder(dto, actor, ctx, contacts, teamGuids, partyEmployeeMap)) {
          skipped.push({ id: pub, reason: "Скрытие недоступно." });
          continue;
        }
        await setPersonalHidden(client, actor.partyId, [internalId], true);
        applied.push(pub);
      } else if (action === "personal-unhide") {
        await setPersonalHidden(client, actor.partyId, [internalId], false);
        applied.push(pub);
      } else if (action === "general-archive") {
        if (!canGeneralArchiveOrder(dto, actor, row)) {
          skipped.push({ id: pub, reason: "Нельзя в общий архив." });
          continue;
        }
        await client.query(
          `UPDATE tt_transfers SET general_archived_at = NOW(), general_archived_by_user_id = $2::uuid WHERE id = $1`,
          [internalId, actor.userId],
        );
        await client.query(
          `INSERT INTO tt_general_archive_audit (transfer_id, action, actor_user_id, reason)
           VALUES ($1, 'archive', $2::uuid, $3)`,
          [internalId, actor.userId, body.reason?.trim() || null],
        );
        applied.push(pub);
      } else if (action === "general-restore") {
        if (!canGeneralRestoreOrder(row, actor)) {
          skipped.push({ id: pub, reason: "Восстановление недоступно." });
          continue;
        }
        await client.query(
          `UPDATE tt_transfers SET general_archived_at = NULL, general_archived_by_user_id = NULL WHERE id = $1`,
          [internalId],
        );
        await client.query(
          `INSERT INTO tt_general_archive_audit (transfer_id, action, actor_user_id, reason)
           VALUES ($1, 'restore', $2::uuid, $3)`,
          [internalId, actor.userId, body.reason?.trim() || null],
        );
        applied.push(pub);
      } else if (action === "delete") {
        if (!(await canDeleteOrder(client, dto, row, actor))) {
          skipped.push({ id: pub, reason: "Удаление недоступно." });
          continue;
        }
        const out = await deleteTransferBeforeFirstCustody(client, internalId, {
          userId: actor.userId,
          partyId: actor.partyId,
        });
        if (!out.ok) {
          skipped.push({ id: pub, reason: out.reason });
          continue;
        }
        applied.push(pub);
      } else {
        skipped.push({ id: pub, reason: "Неизвестное действие." });
      }
    }
  });

  return { applied, skipped };
}

export async function lkRegistryCleanupHandler(req: AccessRequest, res: Response): Promise<void> {
  setNoStore(res);
  if (!req.authUser || !req.accessContext) {
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const party = await findPartyByUserId(pool, req.authUser.id);
  const actor = registryCleanupActorFromAccess(req.authUser, req.accessContext, party?.id ?? null);
  if (!actor || actor.previewReadOnly) {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Действие недоступно."));
    return;
  }
  try {
    const result = await runCleanup(actor, req.body as CleanupBody, req.accessContext, null);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof Error && e.message === "DELETE_ACK") {
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Введите УДАЛИТЬ для подтверждения."));
      return;
    }
    if (e instanceof Error && e.message === "VALIDATION") {
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите действие и передачи."));
      return;
    }
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось выполнить действие."));
  }
}

export async function externalRegistryCleanupHandler(req: Request, res: Response): Promise<void> {
  setNoStore(res);
  const pool = getPool();
  if (!pool) {
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const resolved = await resolveExternalPersonAuth(pool, {
    est: String(req.headers["x-tt-external-est"] ?? req.query.est ?? ""),
    cap: String(req.headers["x-tt-external-cap"] ?? req.query.cap ?? ""),
  });
  if (!resolved) {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна."));
    return;
  }
  const actor = registryCleanupActorFromExternalParty(resolved.partyId);
  const body = req.body as CleanupBody;
  const allowed = new Set(["personal", "personal-restore", "personal-hide", "personal-unhide", "delete"]);
  if (!body.action || !allowed.has(body.action)) {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Действие недоступно."));
    return;
  }
  try {
    const extOrders = await loadExternalPersonOrders(pool, resolved.partyId);
    const allowed = new Set(extOrders.map((o) => o.id));
    const result = await runCleanup(actor, body, null, allowed);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof Error && e.message === "DELETE_ACK") {
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Введите УДАЛИТЬ для подтверждения."));
      return;
    }
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось выполнить действие."));
  }
}
