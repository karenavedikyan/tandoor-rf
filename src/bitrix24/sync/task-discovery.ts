import type { Bitrix24WebhookConfig, Bitrix24OperationContext } from "../types";
import { readBitrixTasksForUser } from "../read-tasks";
import { loadBitrix24TasksRuntimeConfig } from "../tasks/config";
import { listConfirmedLabelTargetsForCard, type CardLabelTarget } from "./card-labels";

export type TaskDiscoveryResult = {
  taskIds: string[];
  complete: boolean;
  truncatedReason?: string;
  /** Transport/config failure when no tasks were discovered yet. */
  fatalError?: string;
  labelsSearched: number;
  pagesUsed: number;
};

export async function discoverResponsibleTasksForCard(input: {
  config: Bitrix24WebhookConfig;
  bitrixUserId: string;
  cardGuid: string;
  holdingGuid: string;
  operation: Bitrix24OperationContext;
  labelTargets?: CardLabelTarget[];
}): Promise<TaskDiscoveryResult> {
  const runtime = loadBitrix24TasksRuntimeConfig();
  const labelTargets =
    input.labelTargets ??
    (await listConfirmedLabelTargetsForCard(input.cardGuid, input.holdingGuid));
  if (labelTargets.length === 0) {
    return { taskIds: [], complete: true, labelsSearched: 0, pagesUsed: 0 };
  }

  const discovered = new Set<string>();
  let complete = true;
  let truncatedReason: string | undefined;
  let fatalError: string | undefined;
  const maxTasks = runtime.workingMaxTasksPerSync;
  const maxPagesPerLabel = runtime.workingMaxDiscoveryPages;
  const maxPagesTotal = runtime.workingMaxDiscoveryPagesTotal;
  let pagesUsed = 0;

  for (const target of labelTargets) {
    if (input.operation.deadline.expired() || discovered.size >= maxTasks) {
      complete = false;
      truncatedReason = truncatedReason ?? "MAX_DURATION";
      break;
    }
    if (pagesUsed >= maxPagesTotal) {
      complete = false;
      truncatedReason = truncatedReason ?? "MAX_PAGES";
      break;
    }

    const pagesRemaining = Math.max(1, maxPagesTotal - pagesUsed);
    const labelPageBudget = Math.min(maxPagesPerLabel, pagesRemaining);

    const readResult = await readBitrixTasksForUser(input.config, input.bitrixUserId, {
      operation: input.operation,
      maxPages: labelPageBudget,
      descriptionContains: target.token,
    });
    pagesUsed += readResult.ok ? readResult.data.pagesFetched : 1;

    if (!readResult.ok) {
      if (discovered.size === 0) {
        return {
          taskIds: [],
          complete: false,
          fatalError: readResult.code,
          truncatedReason: readResult.code,
          labelsSearched: labelTargets.indexOf(target) + 1,
          pagesUsed,
        };
      }
      complete = false;
      truncatedReason = readResult.code;
      break;
    }
    if (!readResult.data.complete) {
      complete = false;
      truncatedReason = readResult.data.truncatedReason ?? "INCOMPLETE";
    }
    for (const task of readResult.data.tasks) {
      if (discovered.size >= maxTasks) {
        complete = false;
        truncatedReason = "MAX_TASKS";
        break;
      }
      discovered.add(task.taskId);
    }
    if (pagesUsed >= maxPagesTotal && !complete) {
      truncatedReason = truncatedReason ?? "MAX_PAGES";
      break;
    }
  }

  return {
    taskIds: [...discovered].sort(),
    complete,
    truncatedReason,
    fatalError,
    labelsSearched: labelTargets.length,
    pagesUsed,
  };
}
