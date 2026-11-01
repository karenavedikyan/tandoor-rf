import type { Response } from "express";
import type { Request } from "express";
import type { AccessRequest } from "../access/middleware";
import { withTransaction } from "../access/db";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import {
  ensurePartyForUserOnWrite,
  findPartyByUserId,
  listRevokedParties,
  listTimelineForTransfer,
  mapTransferToOrderDto,
} from "./repository";
import { requireTanTrackerMutationAccess } from "./guards";
import { resolveTanTrackerAuditUserId, resolveTanTrackerEffectiveUser } from "./effective-user";
import { canViewOrder, orderParticipantIds } from "./scope";
import { loadPartyEmployeeMap } from "./party-employee-map";
import { loadTanTrackerTeamEmployeeGuids } from "./team-scope";
import { buildTanTrackerBootstrap } from "./service";
import {
  insertPersonalRecipientLabelReset,
  insertPersonalRecipientLabelSet,
  PersonalRecipientNameValidationError,
  externalShellPartyCanAccessOrder,
  validatePersonalRecipientName,
} from "./personal-recipient-label";
import { resolveExternalPersonAuth } from "./external-person/resolve-auth";
import { loadExternalPersonOrders } from "./external-person/external-person-orders";

type LabelBody = {
  recipientPartyId?: string;
  personalName?: string;
  reset?: boolean;
};

function parseLabelBody(raw: unknown): LabelBody {
  if (raw === null || typeof raw !== "object") {
    throw Object.assign(new Error("Некорректное тело запроса."), { http: 400 });
  }
  const b = raw as Record<string, unknown>;
  if (b.recipientPartyId !== undefined && typeof b.recipientPartyId !== "string") {
    throw Object.assign(new Error("Укажите получателя."), { http: 400 });
  }
  if (b.personalName !== undefined && typeof b.personalName !== "string") {
    throw Object.assign(new Error("Имя получателя должно быть текстом."), { http: 400 });
  }
  if (b.reset !== undefined && typeof b.reset !== "boolean") {
    throw Object.assign(new Error("Некорректный флаг сброса."), { http: 400 });
  }
  return {
    recipientPartyId: b.recipientPartyId as string | undefined,
    personalName: b.personalName as string | undefined,
    reset: b.reset as boolean | undefined,
  };
}

async function assertTransferRecipientAccess(
  client: import("pg").PoolClient,
  transferPublicId: string,
  ownerPartyId: string,
  recipientPartyId: string,
  access: import("../access/types").AccessContext | null,
  userId: string,
  role: string,
  employeeId: string | null,
  externalActing = false,
): Promise<{ transferInternalId: string }> {
  const row = (
    await client.query<{ id: string }>(
      `SELECT id FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1`,
      [transferPublicId],
    )
  ).rows[0];
  if (!row) {
    throw Object.assign(new Error("Передача не найдена."), { http: 404 });
  }
  const timeline = await listTimelineForTransfer(client, row.id);
  const revoked = await listRevokedParties(client, row.id);
  const transferRow = (
    await client.query(
      `SELECT * FROM tt_transfers WHERE id = $1`,
      [row.id],
    )
  ).rows[0];
  const dto = mapTransferToOrderDto(transferRow, timeline, revoked);
  const participantIds = [...orderParticipantIds(dto)];
  if (!participantIds.includes(recipientPartyId)) {
    throw Object.assign(new Error("Участник не относится к этой передаче."), { http: 400 });
  }
  const teamGuids = access
    ? await loadTanTrackerTeamEmployeeGuids({
        ...access,
        userId,
        role: role as import("../access/types").AccessContext["role"],
      })
    : null;
  const pool = getPool();
  if (!pool) {
    throw Object.assign(new Error("Сервис недоступен."), { http: 503 });
  }
  const partyMap = await loadPartyEmployeeMap(pool, participantIds);
  const ctx = {
    userId,
    role,
    employeeId,
    actorPartyId: ownerPartyId,
    previewReadOnly: false,
  };
  if (externalActing) {
    if (!externalShellPartyCanAccessOrder(ownerPartyId, dto)) {
      throw Object.assign(new Error("Нет доступа к этой передаче."), { http: 403 });
    }
  } else if (!canViewOrder(dto, ctx, [], teamGuids, false, partyMap)) {
    throw Object.assign(new Error("Нет доступа к этой передаче."), { http: 403 });
  }
  return { transferInternalId: row.id };
}

async function applyLabelMutation(
  transferPublicId: string,
  ownerPartyId: string,
  actorUserId: string | null,
  actorDisplayName: string,
  body: LabelBody,
  access: import("../access/types").AccessContext | null,
  userId: string,
  role: string,
  employeeId: string | null,
  externalActing = false,
): Promise<void> {
  const recipientPartyId = String(body.recipientPartyId ?? "").trim();
  if (!recipientPartyId) {
    throw Object.assign(new Error("Укажите получателя."), { http: 400 });
  }
  await withTransaction(async (client) => {
    const { transferInternalId } = await assertTransferRecipientAccess(
      client,
      transferPublicId,
      ownerPartyId,
      recipientPartyId,
      access,
      userId,
      role,
      employeeId,
      externalActing,
    );
    if (body.reset) {
      await insertPersonalRecipientLabelReset(client, {
        transferId: transferInternalId,
        ownerPartyId,
        actorUserId,
        recipientPartyId,
        editorDisplayName: actorDisplayName,
      });
      return;
    }
    const personalName = validatePersonalRecipientName(body.personalName);
    await insertPersonalRecipientLabelSet(client, {
      transferId: transferInternalId,
      ownerPartyId,
      actorUserId,
      recipientPartyId,
      personalName,
      editorDisplayName: actorDisplayName,
    });
  });
}

export async function lkPersonalRecipientLabelHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  setNoStore(res);
  const pool = getPool();
  if (!pool) {
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const user = resolveTanTrackerEffectiveUser(req.authUser!, gate.access);
  let partyId = (await findPartyByUserId(pool, user.id))?.id ?? null;
  if (!partyId) {
    const ensured = await withTransaction((client) =>
      ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone),
    );
    partyId = ensured.id;
  }
  const transferId = String(req.params.id ?? "").trim();
  let body: LabelBody;
  try {
    body = parseLabelBody(req.body);
  } catch (err) {
    const http = (err as { http?: number }).http ?? 400;
    const message = err instanceof Error ? err.message : "Некорректное тело запроса.";
    res.status(http).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
    return;
  }
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, gate.access);
  try {
    await applyLabelMutation(
      transferId,
      partyId,
      auditUserId,
      user.fullName,
      body,
      gate.access,
      user.id,
      user.role,
      gate.access.employeeId,
    );
  } catch (err) {
    if (err instanceof PersonalRecipientNameValidationError) {
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, err.message));
      return;
    }
    const http = (err as { http?: number }).http;
    const message = err instanceof Error ? err.message : "Не удалось сохранить имя.";
    if (http === 400 || http === 403 || http === 404) {
      res.status(http).json(apiError(http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR, message));
      return;
    }
    throw err;
  }
  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, gate.access);
  res.status(200).json({ ok: true, bootstrap });
}

export async function externalPersonalRecipientLabelHandler(req: Request, res: Response): Promise<void> {
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
  const transferId = String(req.params.id ?? "").trim();
  const extOrders = await loadExternalPersonOrders(pool, resolved.partyId);
  if (!extOrders.some((o) => o.id === transferId)) {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нет доступа к этой передаче."));
    return;
  }
  let body: LabelBody;
  try {
    body = parseLabelBody(req.body);
  } catch (err) {
    const http = (err as { http?: number }).http ?? 400;
    const message = err instanceof Error ? err.message : "Некорректное тело запроса.";
    res.status(http).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
    return;
  }
  try {
    await applyLabelMutation(
      transferId,
      resolved.partyId,
      null,
      resolved.displayName,
      body,
      null,
      resolved.personId,
      "manager",
      null,
      true,
    );
  } catch (err) {
    if (err instanceof PersonalRecipientNameValidationError) {
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, err.message));
      return;
    }
    const http = (err as { http?: number }).http;
    const message = err instanceof Error ? err.message : "Не удалось сохранить имя.";
    if (http === 400 || http === 403 || http === 404) {
      res.status(http).json(apiError(http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR, message));
      return;
    }
    throw err;
  }
  const { buildExternalPersonBootstrapPayload } = await import("./external-person/bootstrap-build");
  const bootstrap = await buildExternalPersonBootstrapPayload(pool, resolved);
  res.status(200).json({ ok: true, bootstrap });
}
