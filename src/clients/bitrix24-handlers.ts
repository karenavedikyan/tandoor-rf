import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { formatMskDateTime } from "./dto";
import { isValidUuidParam } from "./uuid-param";
import { canReadClientGuid } from "./repository";
import { getExistingClientLabel, issueClientLabel } from "../bitrix24/labels/service";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import { isChildObjectLinkedToHolding } from "../bitrix24/tasks/object-access";
import { loadBitrix24Config } from "../bitrix24/config";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import { canViewClientCard, canViewTaskForUser } from "../bitrix24/tasks/access";
import type { TaskVisibilityDenyCode } from "../bitrix24/tasks/access";
import { buildTaskPortalUrl } from "../bitrix24/tasks/portal-url";
import { formatTaskStatusLabel } from "../bitrix24/tasks/status-labels";
import { canReadBoundBitrixObject } from "../bitrix24/tasks/object-access";
import { findLatestSyncJournalEntry, listPublishedTasksForObject } from "../bitrix24/tasks/repository";

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

async function resolveLabelTarget(
  req: AccessRequest,
  cardGuid: string,
): Promise<LabelTargetResult> {
  const rawType = req.query.objectType ?? req.body?.objectType;
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== "" && !parseObjectType(rawType)) {
    return { ok: false, message: "Invalid objectType." };
  }
  const objectType = parseObjectType(rawType) ?? "holding";
  if (objectType === "holding") {
    return { ok: true, objectType, objectGuid: cardGuid };
  }
  const objectGuidRaw = req.query.objectGuid ?? req.body?.objectGuid;
  const objectGuid = typeof objectGuidRaw === "string" ? objectGuidRaw.trim() : "";
  if (!isValidUuidParam(objectGuid)) {
    return { ok: false, message: "objectGuid is required for legal_entity and outlet labels." };
  }
  const linked = await isChildObjectLinkedToHolding(cardGuid, objectType, objectGuid);
  if (!linked) {
    return { ok: false, message: "Object is not linked to this client card." };
  }
  return { ok: true, objectType, objectGuid };
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

  const result = await issueClientLabel(target.objectType, target.objectGuid);
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
  });
}

export async function getClientBitrix24TasksHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  const rawType = req.query.objectType;
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== "" && !parseObjectType(rawType)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid objectType."));
    return;
  }
  const objectType = parseObjectType(rawType) ?? "holding";
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
  const rows = await listPublishedTasksForObject(loaded.config.portalId, objectType, cardGuid);

  const visible = [];
  let selfDeny: TaskVisibilityDenyCode | null = null;
  for (const row of rows) {
    const objectAllowed = await canReadBoundBitrixObject(
      context,
      cardGuid,
      row.objectType!,
      row.objectGuid!,
    );
    if (!objectAllowed) {
      continue;
    }
    const visibility = await canViewTaskForUser(context, loaded.config.portalId, row);
    if (!visibility.ok) {
      if (!selfDeny) {
        selfDeny = visibility.code;
      }
      continue;
    }
    visible.push({
      taskId: row.taskId,
      title: row.title,
      statusLabel: formatTaskStatusLabel(row.statusLabel),
      deadline: formatDisplayDate(row.deadline),
      changedAt: formatDisplayDate(row.changedAt),
      responsibleBitrixUserId: row.responsibleBitrixUserId,
      portalUrl: buildTaskPortalUrl(loaded.config.portalHost, runtime.portalPublicUrl, row.taskId),
    });
  }

  let state = "ready";
  let message: string | null = null;
  if (visible.length === 0) {
    if (rows.length === 0) {
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
        case "NO_CLIENT_ACCESS":
          message = "Задача недоступна: ответственный не совпадает с вашим Bitrix ID.";
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
    objectType,
    scopeNote:
      objectType === "holding"
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
      buildTaskPortalUrl(loaded.config.portalHost, runtime.portalPublicUrl, "1"),
    ),
    tasks: visible,
  });
}
