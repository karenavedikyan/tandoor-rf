import type { AccessContext } from "../../access/types";
import { canReadClientGuid } from "../../clients/repository";
import { bitrixChangedAtToDate } from "../parse-changed-at";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "./config";
import { findEmployeePortalLink, type TaskCacheRow } from "./repository";
import { guardPastTimestamp } from "./timestamp-guard";

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

/** Audience-only denials must not leak hidden task existence to card readers. */
export function isAudienceOnlyDeny(code: TaskVisibilityDenyCode): boolean {
  return code === "NO_CLIENT_ACCESS";
}

function isLinkAccessValid(
  link: { accessExpiresAt: string | null; confirmedAt: string },
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
  nowMs = Date.now(),
): boolean {
  if (!isCachePublishAllowed(runtime)) {
    return false;
  }
  const confirmedGuard = guardPastTimestamp(link.confirmedAt, nowMs);
  if (!confirmedGuard.ok) {
    return false;
  }
  if (link.accessExpiresAt) {
    const expiresMs = Date.parse(link.accessExpiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs < nowMs) {
      return false;
    }
  }
  if (runtime.cacheAccessTtlMs > 0) {
    const confirmedAtMs = Date.parse(link.confirmedAt);
    if (confirmedAtMs + runtime.cacheAccessTtlMs < nowMs) {
      return false;
    }
  }
  return true;
}

function isTaskSnapshotCurrent(
  task: TaskCacheRow,
  link: { confirmedAt: string },
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
  nowMs = Date.now(),
): TaskVisibilityResult {
  const syncedGuard = guardPastTimestamp(task.syncedAt, nowMs);
  if (!syncedGuard.ok) {
    return { ok: false, code: syncedGuard.reason === "future" ? "FUTURE_TASK" : "STALE_SNAPSHOT" };
  }
  const syncedAtMs = Date.parse(task.syncedAt);
  const linkConfirmedMs = Date.parse(link.confirmedAt);
  if (!Number.isFinite(linkConfirmedMs)) {
    return { ok: false, code: "STALE_SNAPSHOT" };
  }
  if (syncedAtMs < linkConfirmedMs) {
    return { ok: false, code: "STALE_SNAPSHOT" };
  }
  if (runtime.cacheAccessTtlMs > 0 && syncedAtMs + runtime.cacheAccessTtlMs < nowMs) {
    return { ok: false, code: "ACCESS_EXPIRED" };
  }
  const changedAt = bitrixChangedAtToDate(task.changedAt);
  if (!changedAt) {
    return { ok: false, code: "STALE_SNAPSHOT" };
  }
  if (changedAt.getTime() > nowMs) {
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
