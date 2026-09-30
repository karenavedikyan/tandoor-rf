import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { formatMskDateTime } from "./dto";
import { isValidUuidParam } from "./uuid-param";
import { canReadClientGuid } from "./repository";
import { getExistingClientLabel, issueClientLabel, restoreClientLabel } from "../bitrix24/labels/service";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import { findCardObjectMapping } from "../bitrix24/tasks/card-objects";
import { isObjectLinkedToClientCard } from "../bitrix24/tasks/object-access";
import { loadBitrix24Config } from "../bitrix24/config";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import {
  canViewClientCard,
  canViewTaskForUser,
  evaluateUserBitrixTaskConfig,
  isTaskAudienceMatch,
} from "../bitrix24/tasks/access";
import type { TaskVisibilityDenyCode } from "../bitrix24/tasks/access";
import { buildTaskPortalUrl } from "../bitrix24/tasks/portal-url";
import {
  canReadBoundBitrixObject,
  canRestoreBitrixObjectLabel,
} from "../bitrix24/tasks/object-access";
import {
  findEmployeePortalLink,
  findLatestSyncJournalEntry,
  findPublishedTaskById,
  listPublishedTasksForObject,
} from "../bitrix24/tasks/repository";
import {
  buildFullTaskWorkDto,
  buildSummaryTaskWorkDto,
  parseContactActionBody,
} from "../bitrix24/tasks/task-work-response";
import {
  revokeContactAction,
  setContactActionMarked,
} from "../bitrix24/tasks/work-repository";
import { canMutateBitrixTaskContactAction } from "../bitrix24/tasks/work-access";
import { runClientCardBitrix24Sync } from "../bitrix24/sync/client-card-sync";

const OBJECT_TYPES: Bitrix24ObjectType[] = ["holding", "legal_entity", "outlet"];

function parseObjectType(raw: unknown): Bitrix24ObjectType | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (OBJECT_TYPES.includes(value as Bitrix24ObjectType)) {
    return value as Bitrix24ObjectType;
  }
  return null;
}

type LabelTargetResult =
  | { ok: true; objectType: Bitrix24ObjectType; objectGuid: string }
  | { ok: false; message: string };

type TaskTargetResult =
  | { ok: true; objectType: Bitrix24ObjectType; objectGuid: string; holdingGuid: string }
  | { ok: false; message: string };

async function resolveLabelTarget(
  req: AccessRequest,
  cardGuid: string,
): Promise<LabelTargetResult> {
  const rawType = req.query.objectType ?? req.body?.objectType;
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== "" && !parseObjectType(rawType)) {
    return { ok: false, message: "Invalid objectType." };
  }
  const objectType = parseObjectType(rawType) ?? "holding";
  const cardMapping = await findCardObjectMapping(cardGuid);
  if (!cardMapping || cardMapping.objectType !== "holding") {
    return { ok: false, message: "Client card is not linked to a confirmed holding." };
  }
  const holdingGuid = cardMapping.objectGuid;

  if (objectType === "holding") {
    return { ok: true, objectType, objectGuid: holdingGuid };
  }

  const objectGuidRaw = req.query.objectGuid ?? req.body?.objectGuid;
  const objectGuid = typeof objectGuidRaw === "string" ? objectGuidRaw.trim() : "";
  if (!isValidUuidParam(objectGuid)) {
    return { ok: false, message: "objectGuid is required for legal_entity and outlet labels." };
  }
  const linked = await isObjectLinkedToClientCard(cardGuid, objectType, objectGuid);
  if (!linked) {
    return { ok: false, message: "Object is not linked to this client card." };
  }
  return { ok: true, objectType, objectGuid };
}

async function resolveTaskTarget(
  req: AccessRequest,
  cardGuid: string,
): Promise<TaskTargetResult> {
  const rawType = req.query.objectType;
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== "" && !parseObjectType(rawType)) {
    return { ok: false, message: "Invalid objectType." };
  }
  const objectType = parseObjectType(rawType) ?? "holding";
  const cardMapping = await findCardObjectMapping(cardGuid);
  if (!cardMapping || cardMapping.objectType !== "holding") {
    return { ok: false, message: "Client card is not linked to a confirmed holding." };
  }
  const holdingGuid = cardMapping.objectGuid;

  if (objectType === "holding") {
    return { ok: true, objectType, objectGuid: holdingGuid, holdingGuid };
  }

  const objectGuidRaw = req.query.objectGuid;
  const objectGuid = typeof objectGuidRaw === "string" ? objectGuidRaw.trim() : "";
  if (!isValidUuidParam(objectGuid)) {
    return { ok: false, message: "objectGuid is required for legal_entity and outlet tasks." };
  }
  const linked = await isObjectLinkedToClientCard(cardGuid, objectType, objectGuid);
  if (!linked) {
    return { ok: false, message: "Object is not linked to this client card." };
  }
  return { ok: true, objectType, objectGuid, holdingGuid };
}

function mapDenyCodeToState(code: TaskVisibilityDenyCode): string {
  switch (code) {
    case "NO_EMPLOYEE_LINK":
      return "no_employee_link";
    case "ACCESS_EXPIRED":
      return "access_expired";
    case "PILOT_FILTER":
      return "pilot_filtered";
    case "PILOT_LIST_MISSING":
      return "pilot_list_missing";
    case "STALE_SNAPSHOT":
      return "stale_snapshot";
    case "FUTURE_TASK":
      return "future_task";
    default:
      return "not_published";
  }
}

function formatDisplayDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return formatMskDateTime(date);
}

export async function getClientBitrix24LabelHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!isValidUuidParam(cardGuid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }
  const allowed = await canReadClientGuid(req.accessContext!, cardGuid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const target = await resolveLabelTarget(req, cardGuid);
  if (!target.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, target.message));
    return;
  }

  const objectAccess = await canReadBoundBitrixObject(
    req.accessContext!,
    cardGuid,
    target.objectType,
    target.objectGuid,
  );
  if (!objectAccess) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const result = await getExistingClientLabel(target.objectType, target.objectGuid);
  setNoStore(res);
  if (!result.ok) {
    res.status(result.code === "NOT_ISSUED" ? 404 : 409).json({
      code: result.code,
      message: result.message,
      objectType: target.objectType,
      objectGuid: target.objectGuid,
    });
    return;
  }
  res.status(200).json({
    objectType: result.label.objectType,
    objectGuid: result.label.objectGuid,
    labelCode: result.label.labelCode,
    token: result.token,
    issuedAt: result.label.issuedAt,
  });
}

export async function postClientBitrix24LabelHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!isValidUuidParam(cardGuid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }
  const allowed = await canReadClientGuid(req.accessContext!, cardGuid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const target = await resolveLabelTarget(req, cardGuid);
  if (!target.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, target.message));
    return;
  }

  const objectAccess = await canReadBoundBitrixObject(
    req.accessContext!,
    cardGuid,
    target.objectType,
    target.objectGuid,
  );
  if (!objectAccess) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const actorUserId = req.accessContext!.userId;
  const restoreRequested = req.body?.restore === true;
  if (restoreRequested) {
    const canRestore = await canRestoreBitrixObjectLabel(
      req.accessContext!,
      cardGuid,
      target.objectType,
      target.objectGuid,
    );
    if (!canRestore) {
      setNoStore(res);
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Insufficient rights to restore label."));
      return;
    }
  }
  const result = restoreRequested
    ? await restoreClientLabel(target.objectType, target.objectGuid, actorUserId)
    : await issueClientLabel(target.objectType, target.objectGuid, actorUserId);
  setNoStore(res);
  if (!result.ok) {
    res.status(409).json({
      code: result.code,
      message: result.message,
      objectType: target.objectType,
      objectGuid: target.objectGuid,
    });
    return;
  }
  res.status(result.created ? 201 : 200).json({
    objectType: result.label.objectType,
    objectGuid: result.label.objectGuid,
    labelCode: result.label.labelCode,
    token: result.token,
    issuedAt: result.label.issuedAt,
    created: result.created,
    restored: result.restored ?? false,
  });
}

export async function getClientBitrix24TasksHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!isValidUuidParam(cardGuid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }
  const context = req.accessContext!;
  const allowed = await canViewClientCard(context, cardGuid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const target = await resolveTaskTarget(req, cardGuid);
  if (!target.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, target.message));
    return;
  }

  const loaded = loadBitrix24Config();
  if (!loaded.ok) {
    setNoStore(res);
    res.status(200).json({
      state: "not_configured",
      message: "Bitrix24 integration is not configured.",
      tasks: [],
      sync: null,
    });
    return;
  }

  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!isCachePublishAllowed(runtime)) {
    setNoStore(res);
    res.status(200).json({
      state: "cache_not_published",
      message: "Кэш задач Битрикс24 не опубликован.",
      tasks: [],
      sync: null,
    });
    return;
  }

  const employeeLink = await findEmployeePortalLink(context.userId, loaded.config.portalId);
  const userConfigDeny = await evaluateUserBitrixTaskConfig(context, loaded.config.portalId);
  const syncEntry = employeeLink
    ? await findLatestSyncJournalEntry(loaded.config.portalId, employeeLink.bitrixUserId)
    : null;

  const queryObjectType = target.objectType;
  const queryObjectGuid =
    queryObjectType === "holding" ? target.holdingGuid : target.objectGuid;
  const rows = await listPublishedTasksForObject(
    loaded.config.portalId,
    queryObjectType,
    queryObjectGuid,
  );

  const visible: Record<string, unknown>[] = [];
  let selfDeny: TaskVisibilityDenyCode | null = null;
  let hadAudienceHidden = false;
  let hadObjectHidden = false;
  const actorDisplayName = req.authUser?.fullName ?? "Сотрудник";

  for (const row of rows) {
    if (!row.objectType || !row.objectGuid) {
      continue;
    }
    const objectAllowed = await canReadBoundBitrixObject(
      context,
      cardGuid,
      row.objectType,
      row.objectGuid,
    );
    if (!objectAllowed) {
      hadObjectHidden = true;
      continue;
    }

    const fullDto = await buildFullTaskWorkDto({
      context,
      portalId: loaded.config.portalId,
      cardGuid,
      portalHost: loaded.config.portalHost,
      portalPublicUrl: runtime.portalPublicUrl,
      task: row,
      actorDisplayName,
    });
    if (fullDto) {
      visible.push(fullDto);
      continue;
    }

    const summaryDto = await buildSummaryTaskWorkDto({
      context,
      portalId: loaded.config.portalId,
      cardGuid,
      task: row,
      actorDisplayName,
    });
    if (summaryDto) {
      visible.push(summaryDto);
      continue;
    }

    if (isTaskAudienceMatch(row, employeeLink)) {
      const visibility = await canViewTaskForUser(context, loaded.config.portalId, row);
      if (!visibility.ok && !selfDeny) {
        selfDeny = visibility.code;
      }
    } else {
      hadAudienceHidden = true;
    }
  }

  let state = "ready";
  let message: string | null = null;
  if (visible.length === 0) {
    if (userConfigDeny) {
      state = mapDenyCodeToState(userConfigDeny);
      switch (userConfigDeny) {
        case "NO_EMPLOYEE_LINK":
          message = "Связь сотрудника с порталом Bitrix24 не подтверждена.";
          break;
        case "ACCESS_EXPIRED":
          message = "Данные задач устарели. Требуется повторная синхронизация.";
          break;
        case "PILOT_LIST_MISSING":
          message = "Список разрешённых задач пилота не настроен.";
          break;
        default:
          message = "Кэш задач не опубликован.";
      }
    } else if (rows.length === 0 || hadAudienceHidden || hadObjectHidden) {
      state = "empty";
      message = "Задачи с меткой этого объекта пока не найдены.";
    } else if (selfDeny) {
      state = mapDenyCodeToState(selfDeny);
      switch (selfDeny) {
        case "NO_EMPLOYEE_LINK":
          message = "Связь сотрудника с порталом Bitrix24 не подтверждена.";
          break;
        case "ACCESS_EXPIRED":
        case "STALE_SNAPSHOT":
          message = "Данные задач устарели. Требуется повторная синхронизация.";
          break;
        case "PILOT_FILTER":
          message = "Задача не входит в разрешённый список пилота.";
          break;
        case "PILOT_LIST_MISSING":
          message = "Список разрешённых задач пилота не настроен.";
          break;
        case "FUTURE_TASK":
          message = "Задача содержит некорректную дату обновления.";
          break;
        default:
          message = "Кэш задач не опубликован.";
      }
    } else {
      state = "empty";
      message = "Задачи с меткой этого объекта пока не найдены.";
    }
  }

  setNoStore(res);
  res.status(200).json({
    state,
    message,
    objectType: target.objectType,
    objectGuid: target.objectType === "holding" ? undefined : target.objectGuid,
    scopeNote:
      queryObjectType === "holding"
        ? "Показаны задачи подтверждённого холдинга и связанных объектов; это не полный список задач портала."
        : "Показаны задачи одного подтверждённого объекта; это не полный список задач портала.",
    sync: syncEntry
      ? {
          lastFinishedAt: syncEntry.finishedAt,
          lastFinishedAtLabel: formatDisplayDate(syncEntry.finishedAt),
          lastStatus: syncEntry.status,
          lastRunMode: syncEntry.runMode,
          partial: syncEntry.status === "partial",
        }
      : null,
    portalConfigured: Boolean(
      buildTaskPortalUrl(loaded.config.portalHost, runtime.portalPublicUrl, "1", "1"),
    ),
    tasks: visible,
  });
}

export async function postClientBitrix24SyncHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!isValidUuidParam(cardGuid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }

  const context = req.accessContext!;
  const allowed = await canViewClientCard(context, cardGuid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const target = await resolveTaskTarget(req, cardGuid);
  if (!target.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, target.message));
    return;
  }

  const result = await runClientCardBitrix24Sync({
    context,
    cardGuid,
    objectType: target.objectType,
    objectGuid: target.objectGuid,
    holdingGuid: target.holdingGuid,
  });

  setNoStore(res);
  if (result.httpStatus === 200) {
    res.status(200).json(result.body);
    return;
  }
  if (result.httpStatus === 429) {
    if (result.body.retryAfterMs !== undefined) {
      res.setHeader("Retry-After", String(Math.ceil(result.body.retryAfterMs / 1000)));
    }
    res.status(429).json({
      code: ERROR_CODES.RATE_LIMITED,
      message: result.body.message,
      retryAfterMs: result.body.retryAfterMs,
    });
    return;
  }
  if (result.httpStatus === 503) {
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, result.body.message));
    return;
  }
  res.status(result.httpStatus).json(apiError(ERROR_CODES.FORBIDDEN, result.body.message));
}

export async function putClientBitrix24TaskContactHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  const taskId = String(req.params.taskId ?? "").trim();
  if (!isValidUuidParam(cardGuid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }
  if (!taskId) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid task id."));
    return;
  }

  const context = req.accessContext!;
  const allowed = await canViewClientCard(context, cardGuid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const parsedBody = parseContactActionBody(req.body);
  if (!parsedBody.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, parsedBody.message));
    return;
  }

  const loaded = loadBitrix24Config();
  if (!loaded.ok) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Bitrix24 is not configured."));
    return;
  }

  const task = await findPublishedTaskById(loaded.config.portalId, taskId);
  if (!task?.objectType || !task.objectGuid) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Task not found."));
    return;
  }

  const linked = await isObjectLinkedToClientCard(cardGuid, task.objectType, task.objectGuid);
  if (!linked) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Task not found."));
    return;
  }

  if (!(await canMutateBitrixTaskContactAction(context, loaded.config.portalId, task, cardGuid))) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Insufficient rights for this task."));
    return;
  }

  const actorUserId = context.userId;
  if (parsedBody.marked) {
    const action = await setContactActionMarked({
      portalId: loaded.config.portalId,
      taskId: task.taskId,
      objectType: task.objectType,
      objectGuid: task.objectGuid,
      actorUserId,
      commentText: parsedBody.comment,
    });
    setNoStore(res);
    res.status(200).json({
      marked: true,
      markedAt: action.markedAt,
      markedAtLabel: formatDisplayDate(action.markedAt),
      markedByDisplayName: req.authUser?.fullName ?? null,
      comment: action.commentText,
    });
    return;
  }

  await revokeContactAction({
    portalId: loaded.config.portalId,
    taskId: task.taskId,
    objectType: task.objectType,
    objectGuid: task.objectGuid,
    actorUserId,
  });
  setNoStore(res);
  res.status(200).json({ marked: false });
}
