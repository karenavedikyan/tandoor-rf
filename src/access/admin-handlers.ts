import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AuthenticatedRequest } from "../middleware/auth";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "../clients/uuid-param";
import { query } from "../db/pool";
import { loadAccessContext } from "./context";
import { explainClientAccess } from "./policy";
import {
  addRopTeamMember,
  approveDelegation,
  createAccessGrant,
  createDelegation,
  listAccessOverview,
  revokeDelegation,
  upsertEmployeeLink,
} from "./admin-repository";

function parseUuid(value: unknown, label: string): string | null {
  if (typeof value !== "string" || !isValidUuidParam(value.trim())) {
    return null;
  }
  return value.trim().toLowerCase();
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function accessOverviewHandler(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const overview = await listAccessOverview();
  setNoStore(res);
  res.status(200).json(overview);
}

export async function accessExplainHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const userId = parseUuid(req.query.userId, "userId");
  const clientGuid = parseUuid(req.query.clientGuid, "clientGuid");

  if (!userId || !clientGuid) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Нужны userId и clientGuid."));
    return;
  }

  const userRow = await query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1::uuid",
    [userId],
  );
  if (!userRow.rows[0]) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Пользователь не найден."));
    return;
  }

  const context = await loadAccessContext(userId, userRow.rows[0].role as never);
  const explain = await explainClientAccess(context, clientGuid);
  setNoStore(res);
  res.status(200).json({ explain });
}

export async function createEmployeeLinkHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const userId = parseUuid(req.body?.userId, "userId");
  const employeeId = parseUuid(req.body?.employeeId, "employeeId");
  const basis = parseNonEmptyString(req.body?.basis);

  if (!userId || !employeeId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры связи."));
    return;
  }

  try {
    const result = await upsertEmployeeLink({
      actorUserId: req.authUser!.id,
      userId,
      employeeId,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    setNoStore(res);
    const message =
      error instanceof Error && error.message === "EMPLOYEE_ID_CONFLICT"
        ? "Этот ID сотрудника 1С уже привязан к другому пользователю."
        : error instanceof Error && error.message === "ACTIVE_LINK_EXISTS"
          ? "У пользователя уже есть активная связь."
          : "Не удалось создать связь.";
    res.status(409).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
  }
}

export async function createGrantHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const userId = parseUuid(req.body?.userId, "userId");
  const objectId = parseUuid(req.body?.objectId, "objectId");
  const basis = parseNonEmptyString(req.body?.basis);

  if (!userId || !objectId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры назначения."));
    return;
  }

  const result = await createAccessGrant({
    actorUserId: req.authUser!.id,
    userId,
    objectId,
    basis,
  });
  setNoStore(res);
  res.status(201).json(result);
}

export async function createRopTeamHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const ropUserId = parseUuid(req.body?.ropUserId, "ropUserId");
  const memberUserId = parseUuid(req.body?.memberUserId, "memberUserId");
  const basis = parseNonEmptyString(req.body?.basis);

  if (!ropUserId || !memberUserId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры команды."));
    return;
  }

  const result = await addRopTeamMember({
    actorUserId: req.authUser!.id,
    ropUserId,
    memberUserId,
    basis,
  });
  setNoStore(res);
  res.status(201).json(result);
}

export async function createDelegationHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegatorUserId = parseUuid(req.body?.delegatorUserId, "delegatorUserId");
  const assistantUserId = parseUuid(req.body?.assistantUserId, "assistantUserId");
  const startsAt = parseNonEmptyString(req.body?.startsAt);
  const endsAt = parseNonEmptyString(req.body?.endsAt);
  const basis = parseNonEmptyString(req.body?.basis);
  const statusRaw = parseNonEmptyString(req.body?.status) ?? "pending_approval";
  const clientGuids = Array.isArray(req.body?.clientGuids)
    ? (req.body.clientGuids as unknown[])
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => value.trim().toLowerCase())
        .filter((value: string) => isValidUuidParam(value))
    : [];

  if (
    !delegatorUserId ||
    !assistantUserId ||
    !startsAt ||
    !endsAt ||
    !basis ||
    clientGuids.length === 0
  ) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры замещения."));
    return;
  }

  if (!["draft", "pending_approval", "active"].includes(statusRaw)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый статус замещения."));
    return;
  }

  const result = await createDelegation({
    actorUserId: req.authUser!.id,
    delegatorUserId,
    assistantUserId,
    clientGuids,
    startsAt,
    endsAt,
    status: statusRaw as "draft" | "pending_approval" | "active",
    basis,
  });
  setNoStore(res);
  res.status(201).json(result);
}

export async function approveDelegationHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegationId = parseUuid(req.params.delegationId, "delegationId");
  const basis = parseNonEmptyString(req.body?.basis);
  if (!delegationId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }

  await approveDelegation({
    actorUserId: req.authUser!.id,
    delegationId,
    basis,
  });
  setNoStore(res);
  res.status(200).json({ ok: true });
}

export async function revokeDelegationHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegationId = parseUuid(req.params.delegationId, "delegationId");
  const basis = parseNonEmptyString(req.body?.basis);
  const reason = parseNonEmptyString(req.body?.reason) ?? "Отозвано администратором";
  if (!delegationId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }

  await revokeDelegation({
    actorUserId: req.authUser!.id,
    delegationId,
    reason,
    basis,
  });
  setNoStore(res);
  res.status(200).json({ ok: true });
}
