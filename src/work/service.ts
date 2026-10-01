import type { AccessContext } from "../access/types";
import { loadAccessContext } from "../access/context";
import { loadBitrix24Config } from "../bitrix24/config";
import { isCachePublishAllowed, loadBitrix24TasksRuntimeConfig } from "../bitrix24/tasks/config";
import { evaluateUserBitrixTaskConfig } from "../bitrix24/tasks/access";
import { findLatestSyncJournalEntry } from "../bitrix24/tasks/repository";
import { formatMskDateTime } from "../clients/dto";
import { formatTaskStatusLabel } from "../bitrix24/tasks/status-labels";
import { compareWorkQueueRows, type DeadlineGroup } from "./deadline-groups";
import type { WorkListQuery, WorkStatusFilter } from "./query";
import { listCandidateWorkTasksForScope } from "./repository";
import {
  loadResponsibleProfiles,
  loadWorkAccessBatch,
  loadWorkPageHydration,
} from "./batch-context";
import {
  assembleWorkTaskDto,
  groupCandidateRows,
  resolveWorkTaskIndex,
  type ResolvedWorkTaskIndex,
} from "./assemble-item";

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

function matchesSearch(item: ResolvedWorkTaskIndex, q: string): boolean {
  if (!q) {
    return true;
  }
  return item.searchText.includes(q);
}

function matchesSharedFilters(item: ResolvedWorkTaskIndex, query: WorkListQuery): boolean {
  if (query.clientGuid) {
    const matchesClient = item.clients.some((client) => client.clientGuid === query.clientGuid);
    if (!matchesClient) {
      return false;
    }
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
  if (!matchesSearch(item, normalizeSearch(query.q))) {
    return false;
  }
  return true;
}

function matchesListStatusFilter(
  item: ResolvedWorkTaskIndex,
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

function matchesListFilters(item: ResolvedWorkTaskIndex, query: WorkListQuery): boolean {
  if (!matchesSharedFilters(item, query)) {
    return false;
  }
  if (!matchesListStatusFilter(item, query.status, query.deadlineGroup)) {
    return false;
  }
  if (query.deadlineGroup && item.deadlineGroup !== query.deadlineGroup) {
    return false;
  }
  return true;
}

function buildOptions(
  items: ResolvedWorkTaskIndex[],
  batch: Awaited<ReturnType<typeof loadWorkAccessBatch>>,
): WorkQueueListResponse["options"] {
  const clients = new Map<string, string>();
  const responsibles = new Map<string, string>();
  const statusLabels = new Set<string>();
  for (const item of items) {
    for (const client of item.clients) {
      clients.set(client.clientGuid, client.clientName);
    }
    const bitrixId = item.responsibleBitrixUserId;
    if (bitrixId) {
      const profile = batch.responsibles.get(bitrixId);
      const name =
        profile?.state === "confirmed" && profile.displayName
          ? profile.displayName
          : `ID ${bitrixId}`;
      responsibles.set(bitrixId, name);
    }
    statusLabels.add(item.statusLabelRaw);
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

  const candidates = await listCandidateWorkTasksForScope(context, loaded.config.portalId);
  const batch = await loadWorkAccessBatch({
    context,
    portalId: loaded.config.portalId,
    candidates,
  });

  const resolved: ResolvedWorkTaskIndex[] = [];
  let cacheLatestSyncedAt: string | null = null;

  for (const links of groupCandidateRows(candidates).values()) {
    const item = resolveWorkTaskIndex(context, links, batch);
    if (!item) {
      continue;
    }
    resolved.push(item);
    const syncedAt = links[0]?.syncedAt;
    if (syncedAt && (!cacheLatestSyncedAt || syncedAt > cacheLatestSyncedAt)) {
      cacheLatestSyncedAt = syncedAt;
    }
  }

  const counterBase = resolved.filter((item) => matchesSharedFilters(item, input.query));
  const counts = emptyCounts();
  for (const item of counterBase) {
    counts[item.deadlineGroup] += 1;
  }

  const listFiltered = counterBase
    .filter((item) => matchesListFilters(item, input.query))
    .sort((a, b) => compareWorkQueueRows(a.sortRow, b.sortRow));

  const total = listFiltered.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / input.query.pageSize);
  const offset = (input.query.page - 1) * input.query.pageSize;
  const pageItems = listFiltered.slice(offset, offset + input.query.pageSize);
  const responsibleIds = [
    ...new Set(
      counterBase
        .map((item) => item.responsibleBitrixUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  batch.responsibles = await loadResponsibleProfiles(
    loaded.config.portalId,
    responsibleIds,
    batch.nowMs,
  );
  const pageTaskIds = pageItems.map((item) => item.taskId);
  const hydration = await loadWorkPageHydration({
    portalId: loaded.config.portalId,
    actorUserId: context.userId,
    taskIds: pageTaskIds,
  });
  const items = pageItems.map((index) =>
    assembleWorkTaskDto({
      context,
      index,
      batch,
      hydration,
      portalHost: loaded.config.portalHost,
      portalPublicUrl: runtime.portalPublicUrl,
      actorDisplayName: input.actorDisplayName,
    }),
  );

  const employeeLink = batch.employeeLink;
  const syncEntry = employeeLink
    ? await findLatestSyncJournalEntry(loaded.config.portalId, employeeLink.bitrixUserId)
    : null;

  return {
    state: total > 0 || counterBase.length > 0 ? "ready" : "empty",
    message:
      total > 0 || counterBase.length > 0
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
    options: buildOptions(counterBase, batch),
  };
}
