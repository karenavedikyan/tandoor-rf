import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AuthenticatedRequest } from "../middleware/auth";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "../clients/uuid-param";
import { loadAccessContext } from "./context";
import { AccessServiceError } from "./db";
import { explainClientAccess } from "./policy";
import * as service from "./service";

function parseUuid(value: unknown): string | null {
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

function parseClientGuids(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const guids = (value as unknown[])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => isValidUuidParam(item));
  return guids;
}

function handleServiceError(res: Response, error: unknown): void {
  setNoStore(res);
  if (error instanceof AccessServiceError) {
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : error.code === "FORBIDDEN" ? 403 : 400;
    res.status(status).json(apiError(ERROR_CODES.VALIDATION_ERROR, error.message));
    return;
  }
  throw error;
}

export async function accessExplainHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const userId = parseUuid(req.query.userId);
  const clientGuid = parseUuid(req.query.clientGuid);
  if (!userId || !clientGuid) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Нужны userId и clientGuid."));
    return;
  }

  const context = await loadAccessContext(userId);
  const explain = await explainClientAccess(context, clientGuid);
  setNoStore(res);
  res.status(200).json({ explain, userStatus: context.status });
}

export async function searchUsersHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const q = parseNonEmptyString(req.query.q) ?? "";
  if (q.length < 2) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Минимум 2 символа для поиска."));
    return;
  }
  const users = await service.searchUsers(q);
  setNoStore(res);
  res.status(200).json({ users });
}

export async function scopedOverviewHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const overview = await service.listScopedOverview(req.authUser!.id, req.authUser!.role);
    setNoStore(res);
    res.status(200).json(overview);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function createEmployeeLinkHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const userId = parseUuid(req.body?.userId);
  const employeeId = parseUuid(req.body?.employeeId);
  const basis = parseNonEmptyString(req.body?.basis);
  if (!userId || !employeeId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры связи."));
    return;
  }
  try {
    const result = await service.createEmployeeLink({
      actorUserId: req.authUser!.id,
      userId,
      employeeId,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function revokeEmployeeLinkHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const linkId = parseUuid(req.params.linkId);
  const basis = parseNonEmptyString(req.body?.basis);
  const reason = parseNonEmptyString(req.body?.reason) ?? "Отозвано администратором";
  if (!linkId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.revokeEmployeeLink({
      actorUserId: req.authUser!.id,
      linkId,
      reason,
      basis,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function createGrantHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = parseUuid(req.body?.userId);
  const objectId = parseUuid(req.body?.objectId);
  const basis = parseNonEmptyString(req.body?.basis);
  if (!userId || !objectId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры назначения."));
    return;
  }
  try {
    const result = await service.createAccessGrant({
      actorUserId: req.authUser!.id,
      userId,
      objectId,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function revokeGrantHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const grantId = parseUuid(req.params.grantId);
  const basis = parseNonEmptyString(req.body?.basis);
  const reason = parseNonEmptyString(req.body?.reason) ?? "Отозвано администратором";
  if (!grantId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.revokeAccessGrant({
      actorUserId: req.authUser!.id,
      grantId,
      reason,
      basis,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function createRopTeamHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const ropUserId = parseUuid(req.body?.ropUserId);
  const memberUserId = parseUuid(req.body?.memberUserId);
  const basis = parseNonEmptyString(req.body?.basis);
  if (!ropUserId || !memberUserId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры команды."));
    return;
  }
  try {
    const result = await service.addRopTeamMember({
      actorUserId: req.authUser!.id,
      ropUserId,
      memberUserId,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function revokeRopTeamHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const teamMemberId = parseUuid(req.params.teamMemberId);
  const basis = parseNonEmptyString(req.body?.basis);
  const reason = parseNonEmptyString(req.body?.reason) ?? "Исключён из команды";
  if (!teamMemberId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.revokeRopTeamMember({
      actorUserId: req.authUser!.id,
      teamMemberId,
      reason,
      basis,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function createDenialHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = parseUuid(req.body?.userId);
  const scopeType = req.body?.scopeType === "all_clients" ? "all_clients" : "client";
  const objectId = scopeType === "client" ? parseUuid(req.body?.objectId) : null;
  const reason = parseNonEmptyString(req.body?.reason);
  const basis = parseNonEmptyString(req.body?.basis);
  if (!userId || !reason || !basis || (scopeType === "client" && !objectId)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры запрета."));
    return;
  }
  try {
    const result = await service.createAccessDenial({
      actorUserId: req.authUser!.id,
      userId,
      scopeType,
      objectId,
      reason,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function revokeDenialHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const denialId = parseUuid(req.params.denialId);
  const basis = parseNonEmptyString(req.body?.basis);
  const reason = parseNonEmptyString(req.body?.reason) ?? "Запрет снят";
  if (!denialId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.revokeAccessDenial({
      actorUserId: req.authUser!.id,
      denialId,
      reason,
      basis,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function createDelegationHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegatorUserId =
    req.authUser!.role === "manager"
      ? req.authUser!.id
      : parseUuid(req.body?.delegatorUserId);
  const assistantUserId = parseUuid(req.body?.assistantUserId);
  const startsAt = parseNonEmptyString(req.body?.startsAt);
  const endsAt = parseNonEmptyString(req.body?.endsAt);
  const basis = parseNonEmptyString(req.body?.basis);
  const clientGuids = parseClientGuids(req.body?.clientGuids);
  const submit = req.body?.submit === true;

  if (
    !delegatorUserId ||
    !assistantUserId ||
    !startsAt ||
    !endsAt ||
    !basis ||
    !clientGuids ||
    clientGuids.length === 0
  ) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры замещения."));
    return;
  }

  if (req.body?.status === "active") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нельзя создать замещение со статусом active."));
    return;
  }

  try {
    const result = await service.createDelegationRequest({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegatorUserId,
      assistantUserId,
      clientGuids,
      startsAt,
      endsAt,
      submit,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function submitDelegationHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegationId = parseUuid(req.params.delegationId);
  const basis = parseNonEmptyString(req.body?.basis);
  if (!delegationId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.submitDelegation({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegationId,
      basis,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function approveDelegationHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegationId = parseUuid(req.params.delegationId);
  const basis = parseNonEmptyString(req.body?.basis);
  const businessApproverUserId = parseUuid(req.body?.businessApproverUserId);
  if (!delegationId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  if (req.authUser!.role === "admin" && !businessApproverUserId) {
    setNoStore(res);
    res.status(400).json(
      apiError(
        ERROR_CODES.VALIDATION_ERROR,
        "Администратор должен указать businessApproverUserId.",
      ),
    );
    return;
  }
  try {
    await service.approveDelegationRequest({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegationId,
      basis,
      businessApproverUserId,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function revokeDelegationHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegationId = parseUuid(req.params.delegationId);
  const basis = parseNonEmptyString(req.body?.basis);
  const reason = parseNonEmptyString(req.body?.reason) ?? "Отозвано";
  if (!delegationId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.revokeDelegationRequest({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegationId,
      reason,
      basis,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function proposeDelegationChangeHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const delegationId = parseUuid(req.params.delegationId);
  const startsAt = parseNonEmptyString(req.body?.startsAt);
  const endsAt = parseNonEmptyString(req.body?.endsAt);
  const basis = parseNonEmptyString(req.body?.basis);
  const clientGuids = parseClientGuids(req.body?.clientGuids);
  if (!delegationId || !startsAt || !endsAt || !basis || !clientGuids || clientGuids.length === 0) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры изменения."));
    return;
  }
  try {
    const result = await service.proposeDelegationChange({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegationId,
      clientGuids,
      startsAt,
      endsAt,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function approveDelegationChangeHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const changeRequestId = parseUuid(req.params.changeRequestId);
  const basis = parseNonEmptyString(req.body?.basis);
  const businessApproverUserId = parseUuid(req.body?.businessApproverUserId);
  if (!changeRequestId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.approveDelegationChange({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      changeRequestId,
      basis,
      businessApproverUserId,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}
