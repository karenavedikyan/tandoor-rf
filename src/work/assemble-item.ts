import { formatMskDateTime } from "../clients/dto";
import type { Bitrix24ObjectType } from "../bitrix24/labels/format";
import { buildTaskPortalUrl } from "../bitrix24/tasks/portal-url";
import { formatBoundObjectLabel } from "../bitrix24/tasks/object-type-labels";
import { formatTaskStatusLabel } from "../bitrix24/tasks/status-labels";
import { buildTaskOverviewMetadata } from "../bitrix24/tasks/overview-metadata";
import { buildChecklistPublicDtoFromSnapshot } from "../bitrix24/tasks/checklist-dto";
import { classifyDeadlineGroup } from "./deadline-groups";
import {
  canMutateBitrixTaskContactActionBatch,
  canViewFullTaskBatch,
  canViewSummaryTaskBatch,
  publicationKey,
} from "./access-batch";
import type { WorkBatchContext } from "./batch-context";
import type { CandidateWorkTaskRow } from "./repository";
import type { AccessContext } from "../access/types";

function formatDisplayDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return formatMskDateTime(date);
}

export type WorkTaskCardRef = {
  clientGuid: string;
  clientName: string;
};

export type ResolvedWorkTaskIndex = {
  taskId: string;
  portalId: string;
  clientGuid: string;
  clientName: string;
  clients: WorkTaskCardRef[];
  accessLevel: "full" | "summary";
  title: string | null;
  briefText: string | null;
  deadlineGroup: import("./deadline-groups").DeadlineGroup;
  statusLabelRaw: string;
  responsibleBitrixUserId: string | null;
  searchText: string;
  sortRow: {
    deadlineGroup: import("./deadline-groups").DeadlineGroup;
    deadlineAt: string | null;
    taskId: string;
  };
  deadlineAt: string | null;
  isOverdue: boolean | null;
  candidate: CandidateWorkTaskRow;
};

export function groupCandidateRows(rows: CandidateWorkTaskRow[]): Map<string, CandidateWorkTaskRow[]> {
  const groups = new Map<string, CandidateWorkTaskRow[]>();
  for (const row of rows) {
    const key = `${row.portalId}\0${row.taskId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

export function resolveWorkTaskIndex(
  context: AccessContext,
  links: CandidateWorkTaskRow[],
  batch: WorkBatchContext,
): ResolvedWorkTaskIndex | null {
  if (links.length === 0) {
    return null;
  }
  const task = links[0]!;
  if (!task.objectType || !task.objectGuid) {
    return null;
  }

  const fullCards: WorkTaskCardRef[] = [];
  const summaryCards: WorkTaskCardRef[] = [];

  for (const link of links) {
    if (canViewFullTaskBatch(context, task, link.cardGuid, batch)) {
      fullCards.push({ clientGuid: link.cardGuid, clientName: link.clientName });
    } else if (canViewSummaryTaskBatch(context, task, link.cardGuid, batch)) {
      summaryCards.push({ clientGuid: link.cardGuid, clientName: link.clientName });
    }
  }

  const accessLevel = fullCards.length > 0 ? "full" : summaryCards.length > 0 ? "summary" : null;
  if (!accessLevel) {
    return null;
  }

  const permitted = accessLevel === "full" ? fullCards : summaryCards;
  permitted.sort((a, b) => a.clientGuid.localeCompare(b.clientGuid));
  const primary = permitted[0]!;

  const publication = batch.publications.get(
    publicationKey(task.taskId, task.objectType, task.objectGuid),
  );
  const overview = buildTaskOverviewMetadata(
    task.statusLabel,
    accessLevel === "full" ? task.deadline : null,
    accessLevel === "full",
    batch.nowMs,
  );
  const deadlineGroup = classifyDeadlineGroup(
    task.statusLabel,
    accessLevel === "full" ? task.deadline : null,
    batch.nowMs,
  );

  const clientNames = permitted.map((entry) => entry.clientName).join(" ");
  const searchText = (
    accessLevel === "full"
      ? `${clientNames} ${task.title}`.trim()
      : `${clientNames} ${publication?.briefText ?? ""}`.trim()
  ).toLocaleLowerCase("ru-RU");

  return {
    taskId: task.taskId,
    portalId: task.portalId,
    clientGuid: primary.clientGuid,
    clientName: primary.clientName,
    clients: permitted,
    accessLevel,
    title: accessLevel === "full" ? task.title : null,
    briefText: accessLevel === "summary" ? publication?.briefText ?? null : null,
    deadlineGroup,
    statusLabelRaw: task.statusLabel,
    responsibleBitrixUserId: task.responsibleBitrixUserId,
    searchText,
    sortRow: {
      deadlineGroup,
      deadlineAt: overview.deadlineAt,
      taskId: task.taskId,
    },
    deadlineAt: overview.deadlineAt,
    isOverdue: overview.isOverdue,
    candidate: task,
  };
}

export function assembleWorkTaskDto(input: {
  context: AccessContext;
  index: ResolvedWorkTaskIndex;
  batch: WorkBatchContext;
  portalHost: string;
  portalPublicUrl: string | null;
  actorDisplayName: string;
}): Record<string, unknown> {
  const task = input.index.candidate;
  const objectType = task.objectType as Bitrix24ObjectType;
  const objectGuid = task.objectGuid!;
  const pubKey = publicationKey(task.taskId, objectType, objectGuid);
  const contact = input.batch.contacts.get(pubKey) ?? null;
  const canMark = canMutateBitrixTaskContactActionBatch(
    input.context,
    task,
    input.index.clientGuid,
    input.batch,
  );
  const contactAction = canMark
    ? {
        marked: Boolean(contact),
        markedAt: contact?.markedAt ?? null,
        markedAtLabel: contact ? formatDisplayDate(contact.markedAt) : null,
        markedByDisplayName: contact ? input.actorDisplayName : null,
        comment: contact?.commentText ?? null,
        canMark: true,
        canRevoke: Boolean(contact),
      }
    : null;

  const responsible =
    task.responsibleBitrixUserId && input.batch.responsibles.has(task.responsibleBitrixUserId)
      ? input.batch.responsibles.get(task.responsibleBitrixUserId)!
      : {
          state: "unknown" as const,
          displayName: null,
          lkUserId: null,
          email: null,
        };

  if (input.index.accessLevel === "summary") {
    return {
      taskId: task.taskId,
      accessLevel: "summary",
      briefText: input.index.briefText,
      statusLabel: formatTaskStatusLabel(task.statusLabel),
      boundObjectLabel: formatBoundObjectLabel(objectType),
      responsible,
      contactAction,
      clientGuid: input.index.clientGuid,
      clientName: input.index.clientName,
      clients: input.index.clients,
    };
  }

  const snapshot = input.batch.checklists.get(task.taskId) ?? null;
  const checklist = snapshot
    ? buildChecklistPublicDtoFromSnapshot({
        snapshot,
        objectType,
        objectGuid,
        taskCacheVersion: task.cacheVersion,
        taskSyncedAt: task.syncedAt,
        listMode: true,
      })
    : { state: "not_loaded" as const };

  const overview = buildTaskOverviewMetadata(task.statusLabel, task.deadline, true, input.batch.nowMs);

  return {
    taskId: task.taskId,
    accessLevel: "full",
    title: task.title,
    statusLabel: formatTaskStatusLabel(task.statusLabel),
    deadline: formatDisplayDate(task.deadline),
    changedAt: formatDisplayDate(task.changedAt),
    boundObjectLabel: formatBoundObjectLabel(objectType),
    portalUrl: buildTaskPortalUrl(
      input.portalHost,
      input.portalPublicUrl,
      task.taskId,
      task.responsibleBitrixUserId,
    ),
    responsible,
    checklist,
    contactAction,
    isOpen: overview.isOpen,
    isOverdue: overview.isOverdue,
    deadlineAt: overview.deadlineAt,
    clientGuid: input.index.clientGuid,
    clientName: input.index.clientName,
    clients: input.index.clients,
  };
}
