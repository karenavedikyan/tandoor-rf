import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AuthenticatedRequest } from "../middleware/auth";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "../clients/uuid-param";
import { loadAccessContext } from "./context";
import { AccessServiceError } from "./db";
import { assertCallerCanExplainClient, assertCanExplainAccess } from "./explain-auth";
import { explainClientAccess } from "./policy";
import * as service from "./service";
import { parseDelegationWindow, parseStrictClientGuids } from "./validation";
import { queryEmployeeAuditReport } from "./employee-audit";

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

  const adminRoute = req.baseUrl.includes("/api/admin/access");
  try {
    await assertCanExplainAccess({
      callerUserId: req.authUser!.id,
      callerRole: req.authUser!.role,
      targetUserId: userId,
      adminRoute,
    });
  } catch (error) {
    handleServiceError(res, error);
    return;
  }

  if (!adminRoute) {
    try {
      await assertCallerCanExplainClient({
        callerUserId: req.authUser!.id,
        callerRole: req.authUser!.role,
        clientGuid,
      });
    } catch (error) {
      handleServiceError(res, error);
      return;
    }
  }

  const context = await loadAccessContext(userId);
  const explain = await explainClientAccess(context, clientGuid, { hideExistenceLeak: !adminRoute });
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

function parseOptionalIsoDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

export async function employeeAuditHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = parseUuid(req.query.userId);
  if (!userId) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Нужен userId."));
    return;
  }
  const report = await queryEmployeeAuditReport({
    userId,
    from: parseOptionalIsoDate(req.query.from),
    to: parseOptionalIsoDate(req.query.to),
  });
  setNoStore(res);
  res.status(200).json(report);
}

export async function searchAssistantsHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const q = parseNonEmptyString(req.query.q) ?? "";
  if (q.length < 2) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Минимум 2 символа для поиска."));
    return;
  }
  const assistants = await service.searchAssistants(q);
  setNoStore(res);
  res.status(200).json({ assistants });
}

export async function delegationDetailHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const delegationId = parseUuid(req.params.delegationId);
  if (!delegationId) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный ID замещения."));
    return;
  }
  try {
    const detail = await service.getDelegationDetail({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegationId,
    });
    setNoStore(res);
    res.status(200).json({ delegation: detail });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function delegatorClientsHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const delegatorUserId = parseUuid(req.params.delegatorUserId);
  const page = Number.parseInt(String(req.query.page ?? "1"), 10);
  const pageSize = Number.parseInt(String(req.query.pageSize ?? "50"), 10);
  const q = parseNonEmptyString(req.query.q) ?? "";
  if (!delegatorUserId || !Number.isFinite(page) || page < 1 || !Number.isFinite(pageSize) || pageSize < 1) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    const result = await service.listClientsForDelegator({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegatorUserId,
      page,
      pageSize: Math.min(pageSize, 100),
      q,
    });
    setNoStore(res);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function coordinatorManagersHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.authUser!.role !== "coordinator") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступно только координатору."));
    return;
  }
  try {
    const result = await service.listCoordinatorManagers(req.authUser!.id);
    setNoStore(res);
    res.status(200).json({ managers: result.rows });
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function ropTeamMembersHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.authUser!.role !== "rop") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Доступно только РОП."));
    return;
  }
  try {
    const result = await service.listRopTeamMembers(req.authUser!.id);
    setNoStore(res);
    res.status(200).json({ members: result.rows });
  } catch (error) {
    handleServiceError(res, error);
  }
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
  const basis = parseNonEmptyString(req.body?.basis);
  const submit = req.body?.submit === true;
  const clientGuidsParsed = parseStrictClientGuids(req.body?.clientGuids);
  const windowParsed = parseDelegationWindow(req.body?.startsAt, req.body?.endsAt);

  if (!delegatorUserId || !assistantUserId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры замещения."));
    return;
  }
  if ("error" in clientGuidsParsed) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, clientGuidsParsed.error));
    return;
  }
  if ("error" in windowParsed) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, windowParsed.error));
    return;
  }

  const clientGuids = clientGuidsParsed.guids;
  const startsAt = windowParsed.startsAt;
  const endsAt = windowParsed.endsAt;

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
  const decisionReference = parseNonEmptyString(req.body?.decisionReference);
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
  if (req.authUser!.role === "admin" && !decisionReference) {
    setNoStore(res);
    res.status(400).json(
      apiError(
        ERROR_CODES.VALIDATION_ERROR,
        "Администратор должен указать decisionReference.",
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
      decisionReference,
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
  const basis = parseNonEmptyString(req.body?.basis);
  const clientGuidsParsed = parseStrictClientGuids(req.body?.clientGuids);
  const windowParsed = parseDelegationWindow(req.body?.startsAt, req.body?.endsAt);
  if (!delegationId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры изменения."));
    return;
  }
  if ("error" in clientGuidsParsed) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, clientGuidsParsed.error));
    return;
  }
  if ("error" in windowParsed) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, windowParsed.error));
    return;
  }
  try {
    const result = await service.proposeDelegationChange({
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      delegationId,
      clientGuids: clientGuidsParsed.guids,
      startsAt: windowParsed.startsAt,
      endsAt: windowParsed.endsAt,
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

export async function createCoordinatorTeamHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const coordinatorUserId = parseUuid(req.body?.coordinatorUserId);
  const ropUserId = parseUuid(req.body?.ropUserId);
  const basis = parseNonEmptyString(req.body?.basis);
  if (!coordinatorUserId || !ropUserId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры назначения."));
    return;
  }
  try {
    const result = await service.addCoordinatorTeamAssignment({
      actorUserId: req.authUser!.id,
      coordinatorUserId,
      ropUserId,
      basis,
    });
    setNoStore(res);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(res, error);
  }
}

export async function revokeCoordinatorTeamHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const assignmentId = parseUuid(req.params.assignmentId);
  const basis = parseNonEmptyString(req.body?.basis);
  const reason = parseNonEmptyString(req.body?.reason) ?? "Назначение отозвано";
  if (!assignmentId || !basis) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректные параметры."));
    return;
  }
  try {
    await service.revokeCoordinatorTeamAssignment({
      actorUserId: req.authUser!.id,
      assignmentId,
      reason,
      basis,
    });
    setNoStore(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    handleServiceError(res, error);
  }
}
