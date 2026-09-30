import type { AccessContext } from "../../access/types";
import { canReadClientGuid } from "../../clients/repository";
import { loadBitrix24TasksRuntimeConfig } from "./config";
import { findEmployeePortalLink, type TaskCacheRow } from "./repository";

export type TaskVisibilityResult =
  | { ok: true }
  | { ok: false; code: "NO_EMPLOYEE_LINK" | "ACCESS_EXPIRED" | "NO_CLIENT_ACCESS" | "NOT_PUBLISHED" | "PILOT_FILTER" };

export async function canViewTaskForUser(
  context: AccessContext,
  portalId: string,
  task: TaskCacheRow,
): Promise<TaskVisibilityResult> {
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!runtime.cachePublishEnabled || !task.published) {
    return { ok: false, code: "NOT_PUBLISHED" };
  }

  if (runtime.pilotTaskIds.size > 0 && !runtime.pilotTaskIds.has(task.taskId)) {
    return { ok: false, code: "PILOT_FILTER" };
  }

  const link = await findEmployeePortalLink(context.userId, portalId);
  if (!link) {
    return { ok: false, code: "NO_EMPLOYEE_LINK" };
  }
  if (link.accessExpiresAt && Date.parse(link.accessExpiresAt) < Date.now()) {
    return { ok: false, code: "ACCESS_EXPIRED" };
  }
  if (
    task.responsibleBitrixUserId &&
    task.responsibleBitrixUserId !== link.bitrixUserId
  ) {
    return { ok: false, code: "NO_CLIENT_ACCESS" };
  }
  return { ok: true };
}

export async function canViewClientObjectTasks(
  context: AccessContext,
  objectGuid: string,
): Promise<boolean> {
  const client = await canReadClientGuid(context, objectGuid);
  return client;
}
