import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "./uuid-param";
import { canReadClientGuid } from "./repository";
import { getExistingClientLabel, issueClientLabel } from "../bitrix24/labels/service";
import { loadBitrix24Config } from "../bitrix24/config";
import { loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import { canViewClientObjectTasks, canViewTaskForUser } from "../bitrix24/tasks/access";
import { listPublishedTasksForObject } from "../bitrix24/tasks/repository";

const HOLDING_OBJECT_TYPE = "holding" as const;

function taskPortalUrl(portalPublicUrl: string | null, taskId: string): string | null {
  if (!portalPublicUrl) {
    return null;
  }
  return `${portalPublicUrl.replace(/\/$/, "")}/company/personal/tasks/task/view/${encodeURIComponent(taskId)}/`;
}

export async function getClientBitrix24LabelHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const guid = String(req.params.guid ?? "");
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

  const result = await getExistingClientLabel(HOLDING_OBJECT_TYPE, guid);
  setNoStore(res);
  if (!result.ok) {
    res.status(result.code === "NOT_ISSUED" ? 404 : 409).json({
      code: result.code,
      message: result.message,
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

  const result = await issueClientLabel(HOLDING_OBJECT_TYPE, guid);
  setNoStore(res);
  if (!result.ok) {
    res.status(409).json({ code: result.code, message: result.message });
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
    });
    return;
  }

  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!runtime.cachePublishEnabled) {
    setNoStore(res);
    res.status(200).json({
      state: "cache_not_published",
      message: "Кэш задач Битрикс24 не опубликован.",
      tasks: [],
    });
    return;
  }

  const rows = await listPublishedTasksForObject(
    loaded.config.portalId,
    HOLDING_OBJECT_TYPE,
    guid,
  );

  const visible = [];
  for (const row of rows) {
    const visibility = await canViewTaskForUser(context, loaded.config.portalId, row);
    if (!visibility.ok) {
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
    });
  }

  setNoStore(res);
  res.status(200).json({
    state: visible.length > 0 ? "ready" : "empty",
    scopeNote:
      "Показаны задачи одного подтверждённого объекта; это не полный список задач портала.",
    tasks: visible,
  });
}
