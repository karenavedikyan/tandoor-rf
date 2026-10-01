import type { Bitrix24WebhookConfig, Bitrix24OperationContext } from "../types";
import { extractLabelsFromDescription } from "../labels/parser";
import { parseBitrixUserId } from "../parse-id";
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
  /** False when card has no confirmed labels — not proof tasks disappeared. */
  hasLabelTargets: boolean;
};

function taskMatchesAllowedCardLabels(
  description: string | null | undefined,
  allowedLabelCodes: Set<string>,
): boolean {
  const extracted = extractLabelsFromDescription(description);
  if (!extracted.ok || extracted.labels.length === 0) {
    return false;
  }
  return extracted.labels.some((label) => allowedLabelCodes.has(label.labelCode));
}

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
    return {
      taskIds: [],
      complete: true,
      labelsSearched: 0,
      pagesUsed: 0,
      hasLabelTargets: false,
    };
  }

  const expectedResponsibleId = parseBitrixUserId(input.bitrixUserId);
  if (!expectedResponsibleId) {
    return {
      taskIds: [],
      complete: false,
      fatalError: "INVALID_USER_ID",
      truncatedReason: "INVALID_USER_ID",
      labelsSearched: labelTargets.length,
      pagesUsed: 0,
      hasLabelTargets: true,
    };
  }

  const allowedLabelCodes = new Set(labelTargets.map((target) => target.labelCode));
  const maxTasks = runtime.workingMaxTasksPerSync;
  const maxPagesTotal = runtime.workingMaxDiscoveryPagesTotal;

  const readResult = await readBitrixTasksForUser(input.config, input.bitrixUserId, {
    operation: input.operation,
    maxPages: maxPagesTotal,
  });

  if (!readResult.ok) {
    return {
      taskIds: [],
      complete: false,
      fatalError: readResult.code,
      truncatedReason: readResult.code,
      labelsSearched: labelTargets.length,
      pagesUsed: 1,
      hasLabelTargets: true,
    };
  }

  const discovered = new Set<string>();
  let complete = readResult.data.complete;
  let truncatedReason: string | undefined = readResult.data.truncatedReason;

  for (const task of readResult.data.tasks) {
    if (discovered.size >= maxTasks) {
      complete = false;
      truncatedReason = "MAX_TASKS";
      break;
    }
    if (task.responsibleId !== expectedResponsibleId) {
      continue;
    }
    if (!taskMatchesAllowedCardLabels(task.description, allowedLabelCodes)) {
      continue;
    }
    discovered.add(task.taskId);
  }

  return {
    taskIds: [...discovered].sort(),
    complete,
    truncatedReason,
    labelsSearched: labelTargets.length,
    pagesUsed: readResult.data.pagesFetched,
    hasLabelTargets: true,
  };
}
