import type { AccessContext } from "../../access/types";
import { canReadClientGuid } from "../../clients/repository";
import { bitrixChangedAtToDate } from "../parse-changed-at";
import {
  isCachePublishAllowed,
  isPilotTaskFilterActive,
  loadBitrix24TasksRuntimeConfig,
} from "./config";
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
  | "FUTURE_TASK"
  | "LINK_UNVERIFIED";

export type TaskVisibilityResult = { ok: true } | { ok: false; code: TaskVisibilityDenyCode };

/** Audience-only denials must not leak hidden task existence to card readers. */
export function isAudienceOnlyDeny(code: TaskVisibilityDenyCode): boolean {
  return code === "NO_CLIENT_ACCESS";
}

export type EmployeePortalLinkRow = {
  bitrixUserId: string;
  confirmedAt: string;
  accessExpiresAt: string | null;
  lastVerifiedAt: string | null;
};

export function isLinkIdentityValid(
  link: EmployeePortalLinkRow,
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
  return true;
}

export function isLinkAccessValid(
  link: EmployeePortalLinkRow,
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
  nowMs = Date.now(),
): boolean {
  if (!isLinkIdentityValid(link, runtime, nowMs)) return false;
  if (runtime.linkVerificationTtlMs > 0) {
    if (!link.lastVerifiedAt) {
      return false;
    }
    const verifiedGuard = guardPastTimestamp(link.lastVerifiedAt, nowMs);
    if (!verifiedGuard.ok) {
      return false;
    }
    const verifiedMs = Date.parse(link.lastVerifiedAt);
    if (verifiedMs + runtime.linkVerificationTtlMs < nowMs) {
      return false;
    }
  }
  return true;
}

export function isLinkVerificationFresh(
  link: EmployeePortalLinkRow,
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
  nowMs = Date.now(),
): boolean {
  if (runtime.linkVerificationTtlMs <= 0) {
    return true;
  }
  return isLinkAccessValid(link, runtime, nowMs);
}

function isTaskSnapshotCurrent(
  task: TaskCacheRow,
  link: EmployeePortalLinkRow,
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>,
  nowMs = Date.now(),
): TaskVisibilityResult {
  const syncedGuard = guardPastTimestamp(task.syncedAt, nowMs);
  if (!syncedGuard.ok) {
    return { ok: false, code: syncedGuard.reason === "future" ? "FUTURE_TASK" : "STALE_SNAPSHOT" };
  }
  const syncedAtMs = Date.parse(task.syncedAt);
  const identityFloorMs = Date.parse(link.confirmedAt);
  if (!Number.isFinite(identityFloorMs)) {
    return { ok: false, code: "STALE_SNAPSHOT" };
  }
  if (syncedAtMs < identityFloorMs) {
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

export async function canViewPublishedTaskCacheForUser(
  context: AccessContext,
  portalId: string,
  task: TaskCacheRow,
): Promise<TaskVisibilityResult> {
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!isCachePublishAllowed(runtime) || !task.published) {
    return { ok: false, code: "NOT_PUBLISHED" };
  }

  if (isPilotTaskFilterActive(runtime) && runtime.pilotTaskIds.size === 0) {
    return { ok: false, code: "PILOT_LIST_MISSING" };
  }
  if (isPilotTaskFilterActive(runtime) && !runtime.pilotTaskIds.has(task.taskId)) {
    return { ok: false, code: "PILOT_FILTER" };
  }

  const link = await findEmployeePortalLink(context.userId, portalId);
  if (!link) {
    return { ok: false, code: "NO_EMPLOYEE_LINK" };
  }
  if (!link.lastVerifiedAt && runtime.linkVerificationTtlMs > 0) {
    return { ok: false, code: "LINK_UNVERIFIED" };
  }
  if (!isLinkAccessValid(link, runtime)) {
    return { ok: false, code: "ACCESS_EXPIRED" };
  }
  return isTaskSnapshotCurrent(task, link, runtime);
}

export async function canViewTaskForUser(
  context: AccessContext,
  portalId: string,
  task: TaskCacheRow,
): Promise<TaskVisibilityResult> {
  const cache = await canViewPublishedTaskCacheForUser(context, portalId, task);
  if (!cache.ok) {
    return cache;
  }
  const link = await findEmployeePortalLink(context.userId, portalId);
  if (!task.responsibleBitrixUserId || task.responsibleBitrixUserId !== link?.bitrixUserId) {
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

export function isTaskAudienceMatch(
  task: TaskCacheRow,
  link: { bitrixUserId: string } | null,
): boolean {
  return Boolean(
    link && task.responsibleBitrixUserId && task.responsibleBitrixUserId === link.bitrixUserId,
  );
}

export async function evaluateUserBitrixTaskConfig(
  context: AccessContext,
  portalId: string,
): Promise<TaskVisibilityDenyCode | null> {
  if (context.status !== "active") return "NO_CLIENT_ACCESS";
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!isCachePublishAllowed(runtime)) {
    return "NOT_PUBLISHED";
  }
  if (isPilotTaskFilterActive(runtime) && runtime.pilotTaskIds.size === 0) {
    return "PILOT_LIST_MISSING";
  }
  const link = await findEmployeePortalLink(context.userId, portalId);
  if (!link) {
    return "NO_EMPLOYEE_LINK";
  }
  if (!isLinkIdentityValid(link, runtime)) return "ACCESS_EXPIRED";
  if (!link.lastVerifiedAt && runtime.linkVerificationTtlMs > 0) {
    return "LINK_UNVERIFIED";
  }
  if (!isLinkAccessValid(link, runtime)) {
    return "ACCESS_EXPIRED";
  }
  return null;
}
