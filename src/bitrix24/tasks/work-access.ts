import type { AccessContext } from "../../access/types";
import { isCachePublishAllowed, isPilotTaskFilterActive, loadBitrix24TasksRuntimeConfig } from "./config";
import { findEmployeePortalLink, type TaskBindingRow, type TaskCacheRow } from "./repository";

type TaskWorkRow = TaskCacheRow & Partial<TaskBindingRow>;
import { findActiveSummaryPublication } from "./work-repository";
import {
  canViewPublishedTaskCacheForUser,
  canViewTaskForUser,
  isTaskAudienceMatch,
} from "./access";
import { canReadBoundBitrixObject } from "./object-access";

export async function canViewFullBitrixTaskForUser(
  context: AccessContext,
  portalId: string,
  task: TaskWorkRow,
  cardGuid: string,
): Promise<boolean> {
  if (!task.objectType || !task.objectGuid) {
    return false;
  }
  const visibility = await canViewTaskForUser(context, portalId, task);
  if (!visibility.ok) {
    return false;
  }
  if (!(await canReadBoundBitrixObject(context, cardGuid, task.objectType, task.objectGuid))) {
    return false;
  }
  return true;
}

export async function canViewBitrixTaskSummaryForUser(
  context: AccessContext,
  portalId: string,
  task: TaskWorkRow,
  cardGuid: string,
): Promise<boolean> {
  if (!task.objectType || !task.objectGuid) {
    return false;
  }
  if (await canViewFullBitrixTaskForUser(context, portalId, task, cardGuid)) {
    return false;
  }
  const runtime = loadBitrix24TasksRuntimeConfig();
  if (!isCachePublishAllowed(runtime) || !task.published) {
    return false;
  }
  if (isPilotTaskFilterActive(runtime) && runtime.pilotTaskIds.size === 0) {
    return false;
  }
  if (isPilotTaskFilterActive(runtime) && !runtime.pilotTaskIds.has(task.taskId)) {
    return false;
  }
  const cache = await canViewPublishedTaskCacheForUser(context, portalId, task);
  if (!cache.ok) {
    return false;
  }
  const link = await findEmployeePortalLink(context.userId, portalId);
  if (isTaskAudienceMatch(task, link)) {
    return false;
  }
  if (
    !(await canReadBoundBitrixObject(
      context,
      cardGuid,
      task.objectType,
      task.objectGuid,
    ))
  ) {
    return false;
  }
  const publication = await findActiveSummaryPublication(
    portalId, task.taskId, task.objectType, task.objectGuid,
  );
  return publication !== null;
}

export async function canMutateBitrixTaskContactAction(
  context: AccessContext,
  portalId: string,
  task: TaskWorkRow,
  cardGuid: string,
): Promise<boolean> {
  if (!task.objectType || !task.objectGuid) {
    return false;
  }
  const full = await canViewFullBitrixTaskForUser(context, portalId, task, cardGuid);
  const summary = full
    ? false
    : await canViewBitrixTaskSummaryForUser(context, portalId, task, cardGuid);
  return full || summary;
}
