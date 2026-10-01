import type { Bitrix24WebhookConfig, Bitrix24OperationContext } from "../types";
import { readBitrixTasksForUser } from "../read-tasks";
import { loadBitrix24TasksRuntimeConfig } from "../tasks/config";
import { listConfirmedLabelTargetsForCard, type CardLabelTarget } from "./card-labels";

export type TaskDiscoveryResult = {
  taskIds: string[];
  complete: boolean;
  truncatedReason?: string;
  labelsSearched: number;
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
    return { taskIds: [], complete: true, labelsSearched: 0 };
  }

  const discovered = new Set<string>();
  let complete = true;
  let truncatedReason: string | undefined;
  const maxTasks = runtime.workingMaxTasksPerSync;
  const maxPages = runtime.workingMaxDiscoveryPages;

  for (const target of labelTargets) {
    if (input.operation.deadline.expired() || discovered.size >= maxTasks) {
      complete = false;
      truncatedReason = truncatedReason ?? "MAX_DURATION";
      break;
    }
    const readResult = await readBitrixTasksForUser(input.config, input.bitrixUserId, {
      operation: input.operation,
      maxPages,
      descriptionContains: target.token,
    });
    if (!readResult.ok) {
      complete = false;
      truncatedReason = readResult.code;
      continue;
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
  }

  return {
    taskIds: [...discovered].sort(),
    complete,
    truncatedReason,
    labelsSearched: labelTargets.length,
  };
}
