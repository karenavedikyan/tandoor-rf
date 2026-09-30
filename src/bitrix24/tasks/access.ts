import type { AccessContext } from "../../access/types";
import { canReadClientGuid } from "../../clients/repository";
import { bitrixChangedAtToDate } from "../parse-changed-at";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "./config";
import { findEmployeePortalLink, type TaskCacheRow } from "./repository";

export type TaskVisibilityDenyCode =
  | "NOT_PUBLISHED"
  | "PILOT_FILTER"
  | "PILOT_LIST_MISSING"
  | "NO_EMPLOYEE_LINK"
  | "ACCESS_EXPIRED"
  | "NO_CLIENT_ACCESS"
  | "STALE_SNAPSHOT"
  | "FUTURE_TASK";

export type TaskVisibilityResult = { ok: true } | { ok: false; code: TaskVisibilityDenyCode };

function isLinkAccessValid(
  link: { accessExpiresAt: string | null; confirmedAt: string },
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
): boolean {
  if (!isCachePublishAllowed(runtime)) {
    return false;
  }
  const now = Date.now();
  if (link.accessExpiresAt && Date.parse(link.accessExpiresAt) < now) {
    return false;
  }
  if (runtime.cacheAccessTtlMs > 0) {
    const confirmedAtMs = Date.parse(link.confirmedAt);
    if (!Number.isFinite(confirmedAtMs)) {
      return false;
    }
    if (confirmedAtMs + runtime.cacheAccessTtlMs < now) {
      return false;
    }
  }
  return true;
}

function isTaskSnapshotCurrent(
  task: TaskCacheRow,
  link: { confirmedAt: string },
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
): TaskVisibilityResult {
  const syncedAtMs = Date.parse(task.syncedAt);
  const linkConfirmedMs = Date.parse(link.confirmedAt);
  if (!Number.isFinite(syncedAtMs) || !Number.isFinite(linkConfirmedMs)) {
    return { ok: false, code: "STALE_SNAPSHOT" };
  }
  if (syncedAtMs < linkConfirmedMs) {
    return { ok: false, code: "STALE_SNAPSHOT" };
  }
  if (runtime.cacheAccessTtlMs > 0 && syncedAtMs + runtime.cacheAccessTtlMs < Date.now()) {
    return { ok: false, code: "ACCESS_EXPIRED" };
  }
  const changedAt = bitrixChangedAtToDate(task.changedAt);
  if (!changedAt) {
    return { ok: false, code: "STALE_SNAPSHOT" };
  }
  if (changedAt.getTime() > Date.now()) {
    return { ok: false, code: "FUTURE_TASK" };
  }
  return { ok: true };
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
  const snapshot = isTaskSnapshotCurrent(task, link, runtime);
  if (!snapshot.ok) {
    return snapshot;
  }
  if (!task.responsibleBitrixUserId || task.responsibleBitrixUserId !== link.bitrixUserId) {
    return { ok: false, code: "NO_CLIENT_ACCESS" };
  }
  return { ok: true };
}

export async function canViewClientCard(
  context: AccessContext,
  cardGuid: string,
): Promise<boolean> {
  return canReadClientGuid(context, cardGuid);
}
