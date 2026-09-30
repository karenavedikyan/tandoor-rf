import type { AccessContext } from "../../access/types";
import { canReadClientGuid } from "../../clients/repository";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "./config";
import { findEmployeePortalLink, type TaskCacheRow } from "./repository";

export type TaskVisibilityDenyCode =
  | "NOT_PUBLISHED"
  | "PILOT_FILTER"
  | "PILOT_LIST_MISSING"
  | "NO_EMPLOYEE_LINK"
  | "ACCESS_EXPIRED"
  | "NO_CLIENT_ACCESS";

export type TaskVisibilityResult = { ok: true } | { ok: false; code: TaskVisibilityDenyCode };

function isLinkAccessValid(
  link: { accessExpiresAt: string | null; confirmedAt: string },
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
): boolean {
  if (!isCachePublishAllowed(runtime)) {
    return false;
  }
  if (link.accessExpiresAt) {
    return Date.parse(link.accessExpiresAt) >= Date.now();
  }
  if (runtime.cacheAccessTtlMs > 0) {
    const confirmedAtMs = Date.parse(link.confirmedAt);
    if (!Number.isFinite(confirmedAtMs)) {
      return false;
    }
    return confirmedAtMs + runtime.cacheAccessTtlMs >= Date.now();
  }
  return false;
}

export async function canViewTaskForUser(
  context: AccessContext,
  portalId: string,
  task: TaskCacheRow,
): Promise<TaskVisibilityResult> {
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!isCachePublishAllowed(runtime) || !task.published) {
    return { ok: false, code: "NOT_PUBLISHED" };
  }

  if (runtime.pilotAllowListRequired && runtime.pilotTaskIds.size === 0) {
    return { ok: false, code: "PILOT_LIST_MISSING" };
  }
  if (runtime.pilotTaskIds.size > 0 && !runtime.pilotTaskIds.has(task.taskId)) {
    return { ok: false, code: "PILOT_FILTER" };
  }

  const link = await findEmployeePortalLink(context.userId, portalId);
  if (!link) {
    return { ok: false, code: "NO_EMPLOYEE_LINK" };
  }
  if (!isLinkAccessValid(link, runtime)) {
    return { ok: false, code: "ACCESS_EXPIRED" };
  }
  if (!task.responsibleBitrixUserId || task.responsibleBitrixUserId !== link.bitrixUserId) {
    return { ok: false, code: "NO_CLIENT_ACCESS" };
  }
  return { ok: true };
}

export async function canViewClientObjectTasks(
  context: AccessContext,
  objectGuid: string,
): Promise<boolean> {
  const client = await canReadClientGuid(context, objectGuid);
  return client !== null;
}
