import type { AccessContext } from "../access/types";
import { loadAccessContext } from "../access/context";
import { loadBitrix24Config } from "../bitrix24/config";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import { evaluateUserBitrixTaskConfig } from "../bitrix24/tasks/access";
import { canReadBoundBitrixObject } from "../bitrix24/tasks/object-access";
import { findLatestSyncJournalEntry } from "../bitrix24/tasks/repository";
import {
  buildFullTaskWorkDto,
  buildSummaryTaskWorkDto,
} from "../bitrix24/tasks/task-work-response";
import { formatMskDateTime } from "../clients/dto";
import { formatTaskStatusLabel } from "../bitrix24/tasks/status-labels";
import {
  classifyDeadlineGroup,
  compareWorkQueueRows,
  type DeadlineGroup,
} from "./deadline-groups";
import type { WorkListQuery, WorkStatusFilter } from "./query";
import { listCandidateWorkTasksForScope, type CandidateWorkTaskRow } from "./repository";

export type WorkQueueCounts = Record<DeadlineGroup, number>;

export type WorkQueueListResponse = {
  state: string;
  message: string | null;
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: WorkQueueCounts;
  loadedAt: string;
  loadedAtLabel: string;
  cacheLatestSyncedAt: string | null;
  cacheLatestSyncedAtLabel: string | null;
  sync: {
    lastFinishedAt: string | null;
    lastFinishedAtLabel: string | null;
    lastStatus: string | null;
    lastRunMode: string | null;
    partial: boolean;
  } | null;
  options: {
    clients: Array<{ id: string; name: string }>;
    responsibles: Array<{ id: string; name: string }>;
    statusLabels: Array<{ id: string; name: string }>;
  };
};

type ResolvedWorkItem = Record<string, unknown> & {
  taskId: string;
  portalId: string;
  clientGuid: string;
  clientName: string;
  accessLevel: "full" | "summary";
  deadlineGroup: DeadlineGroup;
  statusLabelRaw: string;
  responsibleBitrixUserId: string | null;
  searchText: string;
  sortRow: {
    deadlineGroup: DeadlineGroup;
    deadlineAt: string | null;
    taskId: string;
  };
};

function emptyCounts(): WorkQueueCounts {
  return {
    overdue: 0,
    today: 0,
    upcoming: 0,
    no_deadline: 0,
    completed: 0,
  };
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU");
}

function matchesSearch(item: ResolvedWorkItem, q: string): boolean {
  if (!q) {
    return true;
  }
  return item.searchText.includes(q);
}

function matchesStatusFilter(
  item: ResolvedWorkItem,
  status: WorkStatusFilter,
  deadlineGroup?: DeadlineGroup,
): boolean {
  if (deadlineGroup === "completed") {
    return item.deadlineGroup === "completed";
  }
  if (status === "all") {
    return true;
  }
  if (status === "completed") {
    return item.deadlineGroup === "completed";
  }
  return item.deadlineGroup !== "completed";
}

function matchesListFilters(
  item: ResolvedWorkItem,
  query: WorkListQuery,
  options: { includeDeadlineGroup: boolean },
): boolean {
  if (query.clientGuid && item.clientGuid !== query.clientGuid) {
    return false;
  }
  if (
    query.responsibleBitrixUserId &&
    item.responsibleBitrixUserId !== query.responsibleBitrixUserId
  ) {
    return false;
  }
  if (query.statusLabel && item.statusLabelRaw !== query.statusLabel) {
    return false;
  }
  if (!matchesStatusFilter(item, query.status, query.deadlineGroup)) {
    return false;
  }
  if (!matchesSearch(item, normalizeSearch(query.q))) {
    return false;
  }
  if (options.includeDeadlineGroup && query.deadlineGroup && item.deadlineGroup !== query.deadlineGroup) {
    return false;
  }
  return true;
}

function buildOptions(items: ResolvedWorkItem[]): WorkQueueListResponse["options"] {
  const clients = new Map<string, string>();
  const responsibles = new Map<string, string>();
  const statusLabels = new Set<string>();
  for (const item of items) {
    clients.set(item.clientGuid, item.clientName);
    const responsible = item.responsible as { displayName?: string | null } | undefined;
    const bitrixId = item.responsibleBitrixUserId;
    if (bitrixId) {
      const name =
        responsible?.displayName && responsible.displayName.trim().length > 0
          ? responsible.displayName
          : `ID ${bitrixId}`;
      responsibles.set(bitrixId, name);
    }
    if (typeof item.statusLabelRaw === "string") {
      statusLabels.add(item.statusLabelRaw);
    }
  }
  return {
    clients: [...clients.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    responsibles: [...responsibles.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    statusLabels: [...statusLabels]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((raw) => ({ id: raw, name: formatTaskStatusLabel(raw) })),
  };
}

async function resolveVisibleWorkItem(
  context: AccessContext,
  candidate: CandidateWorkTaskRow,
  portalHost: string,
  portalPublicUrl: string | null,
  actorDisplayName: string,
): Promise<ResolvedWorkItem | null> {
  if (!candidate.objectType || !candidate.objectGuid) {
    return null;
  }
  if (
    !(await canReadBoundBitrixObject(
      context,
      candidate.cardGuid,
      candidate.objectType,
      candidate.objectGuid,
    ))
  ) {
    return null;
  }

  const full = await buildFullTaskWorkDto({
    context,
    portalId: candidate.portalId,
    cardGuid: candidate.cardGuid,
    portalHost,
    portalPublicUrl,
    task: candidate,
    actorDisplayName,
    listMode: true,
  });
  if (full) {
    const deadlineGroup = classifyDeadlineGroup(candidate.statusLabel, candidate.deadline);
    const searchText = normalizeSearch(
      `${candidate.clientName} ${String(full.title ?? "")}`,
    );
    return {
      ...full,
      taskId: candidate.taskId,
      portalId: candidate.portalId,
      clientGuid: candidate.cardGuid,
      clientName: candidate.clientName,
      accessLevel: "full",
      deadlineGroup,
      statusLabelRaw: candidate.statusLabel,
      responsibleBitrixUserId: candidate.responsibleBitrixUserId,
      searchText,
      sortRow: {
        deadlineGroup,
        deadlineAt: typeof full.deadlineAt === "string" ? full.deadlineAt : null,
        taskId: candidate.taskId,
      },
    };
  }

  const summary = await buildSummaryTaskWorkDto({
    context,
    portalId: candidate.portalId,
    cardGuid: candidate.cardGuid,
    task: candidate,
    actorDisplayName,
  });
  if (!summary) {
    return null;
  }
  const deadlineGroup = classifyDeadlineGroup(candidate.statusLabel, null);
  const searchText = normalizeSearch(
    `${candidate.clientName} ${String(summary.briefText ?? "")}`,
  );
  return {
    ...summary,
    taskId: candidate.taskId,
    portalId: candidate.portalId,
    clientGuid: candidate.cardGuid,
    clientName: candidate.clientName,
    accessLevel: "summary",
    deadlineGroup,
    statusLabelRaw: candidate.statusLabel,
    responsibleBitrixUserId: candidate.responsibleBitrixUserId,
    searchText,
    sortRow: {
      deadlineGroup,
      deadlineAt: null,
      taskId: candidate.taskId,
    },
  };
}

export async function listWorkQueueForUser(input: {
  context: AccessContext;
  query: WorkListQuery;
  actorDisplayName: string;
}): Promise<WorkQueueListResponse> {
  const loadedAt = new Date();
  const context = await loadAccessContext(input.context.userId);
  const runtime = loadBitrix24TasksRuntimeConfig();
  const loaded = loadBitrix24Config();

  if (!loaded.ok || !isCachePublishAllowed(runtime)) {
    return {
      state: "not_configured",
      message: "Кэш задач Bitrix24 не опубликован.",
      items: [],
      total: 0,
      page: input.query.page,
      pageSize: input.query.pageSize,
      totalPages: 0,
      counts: emptyCounts(),
      loadedAt: loadedAt.toISOString(),
      loadedAtLabel: formatMskDateTime(loadedAt),
      cacheLatestSyncedAt: null,
      cacheLatestSyncedAtLabel: null,
      sync: null,
      options: { clients: [], responsibles: [], statusLabels: [] },
    };
  }

  const configDeny = await evaluateUserBitrixTaskConfig(context, loaded.config.portalId);
  if (configDeny) {
    const message =
      configDeny === "NO_EMPLOYEE_LINK"
        ? "Связь сотрудника с порталом Bitrix24 не подтверждена."
        : "Данные задач устарели. Требуется повторная синхронизация.";
    return {
      state: configDeny === "NO_EMPLOYEE_LINK" ? "no_employee_link" : "access_expired",
      message,
      items: [],
      total: 0,
      page: input.query.page,
      pageSize: input.query.pageSize,
      totalPages: 0,
      counts: emptyCounts(),
      loadedAt: loadedAt.toISOString(),
      loadedAtLabel: formatMskDateTime(loadedAt),
      cacheLatestSyncedAt: null,
      cacheLatestSyncedAtLabel: null,
      sync: null,
      options: { clients: [], responsibles: [], statusLabels: [] },
    };
  }

  const candidates = await listCandidateWorkTasksForScope(context);
  const resolved: ResolvedWorkItem[] = [];
  let cacheLatestSyncedAt: string | null = null;

  for (const candidate of candidates) {
    const item = await resolveVisibleWorkItem(
      context,
      candidate,
      loaded.config.portalHost,
      runtime.portalPublicUrl,
      input.actorDisplayName,
    );
    if (!item) {
      continue;
    }
    resolved.push(item);
    if (!cacheLatestSyncedAt || candidate.syncedAt > cacheLatestSyncedAt) {
      cacheLatestSyncedAt = candidate.syncedAt;
    }
  }

  const baseFiltered = resolved.filter((item) =>
    matchesListFilters(item, input.query, { includeDeadlineGroup: false }),
  );

  const counts = emptyCounts();
  for (const item of baseFiltered) {
    counts[item.deadlineGroup] += 1;
  }

  const pageFiltered = baseFiltered
    .filter((item) => matchesListFilters(item, input.query, { includeDeadlineGroup: true }))
    .sort((a, b) => compareWorkQueueRows(a.sortRow, b.sortRow));

  const total = pageFiltered.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / input.query.pageSize);
  const offset = (input.query.page - 1) * input.query.pageSize;
  const items = pageFiltered.slice(offset, offset + input.query.pageSize).map((item) => {
    const { searchText, sortRow, statusLabelRaw, responsibleBitrixUserId, ...dto } = item;
    void searchText;
    void sortRow;
    void statusLabelRaw;
    void responsibleBitrixUserId;
    return dto;
  });

  const employeeLink = await import("../bitrix24/tasks/repository").then((mod) =>
    mod.findEmployeePortalLink(context.userId, loaded.config.portalId),
  );
  const syncEntry = employeeLink
    ? await findLatestSyncJournalEntry(loaded.config.portalId, employeeLink.bitrixUserId)
    : null;

  return {
    state: total > 0 || baseFiltered.length > 0 ? "ready" : "empty",
    message:
      total > 0 || baseFiltered.length > 0
        ? null
        : "Задачи с меткой доступных объектов пока не найдены.",
    items,
    total,
    page: input.query.page,
    pageSize: input.query.pageSize,
    totalPages,
    counts,
    loadedAt: loadedAt.toISOString(),
    loadedAtLabel: formatMskDateTime(loadedAt),
    cacheLatestSyncedAt,
    cacheLatestSyncedAtLabel: cacheLatestSyncedAt
      ? formatMskDateTime(new Date(cacheLatestSyncedAt))
      : null,
    sync: syncEntry
      ? {
          lastFinishedAt: syncEntry.finishedAt,
          lastFinishedAtLabel: syncEntry.finishedAt
            ? formatMskDateTime(new Date(syncEntry.finishedAt))
            : null,
          lastStatus: syncEntry.status,
          lastRunMode: syncEntry.runMode,
          partial: syncEntry.status === "partial",
        }
      : null,
    options: buildOptions(baseFiltered),
  };
}
