import { dedupeBitrixTasks, normalizeBitrixTask } from "./normalize-task";
import { callBitrix24Method, type Bitrix24TransportOptions } from "./transport";
import type {
  Bitrix24TaskListResult,
  Bitrix24TransportResult,
  Bitrix24WebhookConfig,
} from "./types";
import { parseBitrixUserId } from "./read-users";

const TASK_SELECT_FIELDS = [
  "ID",
  "TITLE",
  "STATUS",
  "REAL_STATUS",
  "RESPONSIBLE_ID",
  "CREATED_BY",
  "DEADLINE",
  "CHANGED_DATE",
] as const;

function extractTaskList(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result;
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.tasks)) {
      return record.tasks;
    }
  }
  return [];
}

export type ReadBitrixTasksResult =
  | { ok: true; data: Bitrix24TaskListResult }
  | { ok: false; code: string; message: string; transport?: Bitrix24TransportResult };

export async function readBitrixTasksForUser(
  config: Bitrix24WebhookConfig,
  bitrixUserId: string,
  options: Bitrix24TransportOptions & { maxPages?: number } = {},
): Promise<ReadBitrixTasksResult> {
  const parsedId = parseBitrixUserId(bitrixUserId);
  if (!parsedId) {
    return {
      ok: false,
      code: "INVALID_USER_ID",
      message: "Bitrix24 user ID must be a positive integer.",
    };
  }

  const startedAt = options.startedAt ?? Date.now();
  const maxPages = options.maxPages ?? config.maxPages;
  const tasks = [];
  let pagesFetched = 0;
  let totalReported: number | null = null;
  let start = 0;
  let truncatedReason: Bitrix24TaskListResult["truncatedReason"];
  let previousFirstTaskId: string | undefined;
  let lastTransport: Bitrix24TransportResult | undefined;

  while (true) {
    if (pagesFetched >= maxPages) {
      if (lastTransport?.ok && lastTransport.next !== null && lastTransport.next !== undefined) {
        truncatedReason = "MAX_PAGES";
      }
      break;
    }

    if (Date.now() - startedAt >= config.maxTotalDurationMs) {
      truncatedReason = "MAX_DURATION";
      break;
    }

    const transport = await callBitrix24Method(
      config,
      "tasks.task.list",
      {
        order: { CHANGED_DATE: "desc" },
        filter: { RESPONSIBLE_ID: parsedId },
        select: [...TASK_SELECT_FIELDS],
        start,
      },
      {
        ...options,
        startedAt,
        maxTotalDurationMs: config.maxTotalDurationMs,
      },
    );
    lastTransport = transport;

    if (!transport.ok) {
      return {
        ok: false,
        code: transport.code,
        message: transport.message,
        transport,
      };
    }

    pagesFetched += 1;
    totalReported = transport.total ?? totalReported;

    const pageTasks = extractTaskList(transport.result)
      .map((entry) => normalizeBitrixTask(config.portalHost, entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (pageTasks.length === 0) {
      break;
    }

    const firstTaskId = pageTasks[0]?.taskId;
    if (firstTaskId && firstTaskId === previousFirstTaskId) {
      truncatedReason = "DUPLICATE_CURSOR";
      break;
    }
    previousFirstTaskId = firstTaskId;

    tasks.push(...pageTasks);

    if (transport.next === null || transport.next === undefined) {
      break;
    }
    if (transport.next <= start) {
      truncatedReason = "INVALID_PAGE";
      break;
    }
    start = transport.next;
  }

  const deduped = dedupeBitrixTasks(tasks);
  const complete = truncatedReason === undefined;

  return {
    ok: true,
    data: {
      tasks: deduped,
      totalReported,
      pagesFetched,
      complete,
      truncatedReason,
    },
  };
}
