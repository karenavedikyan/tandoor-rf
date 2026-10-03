import type { AccessContext } from "../access/types";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import {
  isLinkAccessValid,
  isTaskAudienceMatch,
  isTaskSnapshotCurrent,
  type EmployeePortalLinkRow,
} from "../bitrix24/tasks/access";
import { isPilotTaskFilterActive, loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import type { TaskCacheRow } from "../bitrix24/tasks/repository";
import type { SummaryPublicationRow } from "../bitrix24/tasks/work-repository";

export type WorkAccessBatch = {
  runtime: ReturnType<typeof loadBitrix24TasksRuntimeConfig>;
  employeeLink: EmployeePortalLinkRow | null;
  cardHoldings: Map<string, string>;
  hierarchyLinks: Set<string>;
  deniedObjectIds: Set<string>;
  deniedAllClients: boolean;
  grantedObjectIds: Set<string>;
  publications: Map<string, SummaryPublicationRow>;
  /** Wall clock for link/cache TTL checks. */
  nowMs: number;
  /** Injectable clock for deadline grouping (see WORK_QUEUE_FIXED_NOW_MS). */
  deadlineNowMs: number;
};

export function publicationKey(
  taskId: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): string {
  return `${taskId}\0${objectType}\0${objectGuid.toLowerCase()}`;
}

export function hierarchyKey(
  holdingGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
): string {
  return `${holdingGuid.toLowerCase()}\0${objectType}\0${objectGuid.toLowerCase()}`;
}

function isObjectExplicitlyDenied(batch: WorkAccessBatch, objectGuid: string): boolean {
  if (batch.deniedAllClients) {
    return true;
  }
  return batch.deniedObjectIds.has(objectGuid.toLowerCase());
}

function hasExplicitBitrixObjectGrant(context: AccessContext, objectGuid: string, batch: WorkAccessBatch): boolean {
  if (isObjectExplicitlyDenied(batch, objectGuid)) {
    return false;
  }
  if (context.role === "admin" || context.fullClientBase) {
    return true;
  }
  return batch.grantedObjectIds.has(objectGuid.toLowerCase());
}

function isBoundObjectHierarchyDenied(
  context: AccessContext,
  cardGuid: string,
  holdingGuid: string,
  objectGuid: string,
  batch: WorkAccessBatch,
): boolean {
  if (isObjectExplicitlyDenied(batch, cardGuid)) {
    return true;
  }
  if (isObjectExplicitlyDenied(batch, holdingGuid)) {
    return true;
  }
  if (objectGuid !== holdingGuid && isObjectExplicitlyDenied(batch, objectGuid)) {
    return true;
  }
  return false;
}

export function isObjectLinkedToCardBatch(
  cardGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  batch: WorkAccessBatch,
): boolean {
  const holdingGuid = batch.cardHoldings.get(cardGuid.toLowerCase());
  if (!holdingGuid) {
    return false;
  }
  if (objectType === "holding") {
    return objectGuid.toLowerCase() === holdingGuid.toLowerCase();
  }
  return batch.hierarchyLinks.has(hierarchyKey(holdingGuid, objectType, objectGuid));
}

export function canReadBoundBitrixObjectBatch(
  context: AccessContext,
  cardGuid: string,
  objectType: Bitrix24ObjectType,
  objectGuid: string,
  batch: WorkAccessBatch,
): boolean {
  if (!isObjectLinkedToCardBatch(cardGuid, objectType, objectGuid, batch)) {
    return false;
  }
  const holdingGuid = batch.cardHoldings.get(cardGuid.toLowerCase());
  if (!holdingGuid) {
    return false;
  }
  if (isBoundObjectHierarchyDenied(context, cardGuid, holdingGuid, objectGuid, batch)) {
    return false;
  }
  if (objectType === "holding") {
    return true;
  }
  return hasExplicitBitrixObjectGrant(context, objectGuid, batch);
}

export function canViewPublishedTaskCacheBatch(
  task: TaskCacheRow,
  batch: WorkAccessBatch,
): boolean {
  const runtime = batch.runtime;
  if (!task.published) {
    return false;
  }
  if (isPilotTaskFilterActive(runtime) && runtime.pilotTaskIds.size === 0) {
    return false;
  }
  if (isPilotTaskFilterActive(runtime) && !runtime.pilotTaskIds.has(task.taskId)) {
    return false;
  }
  if (!batch.employeeLink) {
    return false;
  }
  if (!batch.employeeLink.lastVerifiedAt && runtime.linkVerificationTtlMs > 0) {
    return false;
  }
  if (!isLinkAccessValid(batch.employeeLink, runtime, batch.nowMs)) {
    return false;
  }
  return isTaskSnapshotCurrent(task, batch.employeeLink, runtime, batch.nowMs).ok;
}

export function canViewFullTaskBatch(
  context: AccessContext,
  task: TaskCacheRow & { objectType?: Bitrix24ObjectType | null; objectGuid?: string | null },
  cardGuid: string,
  batch: WorkAccessBatch,
): boolean {
  if (!task.objectType || !task.objectGuid) {
    return false;
  }
  if (!canViewPublishedTaskCacheBatch(task, batch)) {
    return false;
  }
  if (
    !task.responsibleBitrixUserId ||
    task.responsibleBitrixUserId !== batch.employeeLink?.bitrixUserId
  ) {
    return false;
  }
  return canReadBoundBitrixObjectBatch(context, cardGuid, task.objectType, task.objectGuid, batch);
}

export function canMutateBitrixTaskContactActionBatch(
  context: AccessContext,
  task: TaskCacheRow & { objectType?: Bitrix24ObjectType | null; objectGuid?: string | null },
  cardGuid: string,
  batch: WorkAccessBatch,
): boolean {
  return (
    canViewFullTaskBatch(context, task, cardGuid, batch) ||
    canViewSummaryTaskBatch(context, task, cardGuid, batch)
  );
}

export function canViewSummaryTaskBatch(
  context: AccessContext,
  task: TaskCacheRow & { objectType?: Bitrix24ObjectType | null; objectGuid?: string | null },
  cardGuid: string,
  batch: WorkAccessBatch,
): boolean {
  if (!task.objectType || !task.objectGuid) {
    return false;
  }
  if (canViewFullTaskBatch(context, task, cardGuid, batch)) {
    return false;
  }
  if (!canViewPublishedTaskCacheBatch(task, batch)) {
    return false;
  }
  if (isTaskAudienceMatch(task, batch.employeeLink)) {
    return false;
  }
  if (!canReadBoundBitrixObjectBatch(context, cardGuid, task.objectType, task.objectGuid, batch)) {
    return false;
  }
  return batch.publications.has(publicationKey(task.taskId, task.objectType, task.objectGuid));
}
