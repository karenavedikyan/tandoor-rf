import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "./uuid-param";
import { canReadClientGuid } from "./repository";
import { getExistingClientLabel, issueClientLabel } from "../bitrix24/labels/service";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import { loadBitrix24Config } from "../bitrix24/config";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import { canViewClientObjectTasks, canViewTaskForUser } from "../bitrix24/tasks/access";
import type { TaskVisibilityDenyCode } from "../bitrix24/tasks/access";
import { findLatestSyncJournalEntry, listPublishedTasksForObject } from "../bitrix24/tasks/repository";

const OBJECT_TYPES: Bitrix24ObjectType[] = ["holding", "legal_entity", "outlet"];

function parseObjectType(raw: unknown): Bitrix24ObjectType | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (OBJECT_TYPES.includes(value as Bitrix24ObjectType)) {
    return value as Bitrix24ObjectType;
  }
  return null;
}

function resolveObjectType(req: AccessRequest): Bitrix24ObjectType {
  return parseObjectType(req.query.objectType) ?? "holding";
}

function taskPortalUrl(portalPublicUrl: string | null, taskId: string): string | null {
  if (!portalPublicUrl) {
    return null;
  }
  try {
    const base = new URL(portalPublicUrl);
    if (base.protocol !== "https:") {
      return null;
    }
    return `${base.origin}/company/personal/tasks/task/view/${encodeURIComponent(taskId)}/`;
  } catch {
    return null;
  }
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
    case "NO_CLIENT_ACCESS":
      return "audience_denied";
    default:
      return "not_published";
  }
}

export async function getClientBitrix24LabelHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const guid = String(req.params.guid ?? "");
  const objectType = resolveObjectType(req);
  if (!isValidUuidParam(guid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }
  const allowed = await canReadClientGuid(req.accessContext!, guid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const result = await getExistingClientLabel(objectType, guid);
  setNoStore(res);
  if (!result.ok) {
    res.status(result.code === "NOT_ISSUED" ? 404 : 409).json({
      code: result.code,
      message: result.message,
      objectType,
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
  const guid = String(req.params.guid ?? "");
  const objectType = parseObjectType(req.body?.objectType) ?? resolveObjectType(req);
  if (!isValidUuidParam(guid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }
  const allowed = await canReadClientGuid(req.accessContext!, guid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return;
  }

  const result = await issueClientLabel(objectType, guid);
  setNoStore(res);
  if (!result.ok) {
    res.status(409).json({ code: result.code, message: result.message, objectType });
    return;
  }
  res.status(result.created ? 201 : 200).json({
    objectType: result.label.objectType,
    objectGuid: result.label.objectGuid,
    labelCode: result.label.labelCode,
    token: result.token,
    issuedAt: result.label.issuedAt,
    created: result.created,
  });
}

export async function getClientBitrix24TasksHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const guid = String(req.params.guid ?? "");
  const objectType = resolveObjectType(req);
  if (!isValidUuidParam(guid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return;
  }
  const context = req.accessContext!;
  const allowed = await canViewClientObjectTasks(context, guid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
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

  const syncEntry = await findLatestSyncJournalEntry(loaded.config.portalId);
  const rows = await listPublishedTasksForObject(loaded.config.portalId, objectType, guid);

  const visible = [];
  const denyCounts: Partial<Record<TaskVisibilityDenyCode, number>> = {};
  for (const row of rows) {
    const visibility = await canViewTaskForUser(context, loaded.config.portalId, row);
    if (!visibility.ok) {
      denyCounts[visibility.code] = (denyCounts[visibility.code] ?? 0) + 1;
      continue;
    }
    visible.push({
      taskId: row.taskId,
      title: row.title,
      statusLabel: row.statusLabel,
      deadline: row.deadline,
      changedAt: row.changedAt,
      responsibleBitrixUserId: row.responsibleBitrixUserId,
      portalUrl: taskPortalUrl(runtime.portalPublicUrl, row.taskId),
      boundObjectType: row.objectType,
    });
  }

  let state = "ready";
  let message: string | null = null;
  if (visible.length === 0) {
    const dominantDeny = Object.entries(denyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as
      | TaskVisibilityDenyCode
      | undefined;
    if (rows.length === 0) {
      state = "empty";
      message = "Задачи с меткой этого объекта пока не найдены.";
    } else if (dominantDeny) {
      state = mapDenyCodeToState(dominantDeny);
      switch (dominantDeny) {
        case "NO_EMPLOYEE_LINK":
          message = "Связь сотрудника с порталом Bitrix24 не подтверждена.";
          break;
        case "ACCESS_EXPIRED":
          message = "Подтверждение доступа к Bitrix24 истекло.";
          break;
        case "PILOT_FILTER":
          message = "Задача не входит в разрешённый список пилота.";
          break;
        case "PILOT_LIST_MISSING":
          message = "Список разрешённых задач пилота не настроен.";
          break;
        case "NO_CLIENT_ACCESS":
          message = "Задача недоступна: ответственный не совпадает с вашим Bitrix ID.";
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
    objectType,
    scopeNote:
      objectType === "holding"
        ? "Показаны задачи подтверждённого холдинга и связанных объектов; это не полный список задач портала."
        : "Показаны задачи одного подтверждённого объекта; это не полный список задач портала.",
    visibility: {
      totalBound: rows.length,
      visibleCount: visible.length,
      filteredCount: rows.length - visible.length,
      denyCounts,
    },
    sync: syncEntry
      ? {
          lastFinishedAt: syncEntry.finishedAt,
          lastStatus: syncEntry.status,
          lastRunMode: syncEntry.runMode,
        }
      : null,
    portalConfigured: Boolean(runtime.portalPublicUrl),
    tasks: visible,
  });
}
