import { dedupeBitrixTasks, normalizeBitrixTask } from "./normalize-task";
import { SAFE_READ_MESSAGES } from "./safe-errors";
import { callBitrix24Method, createOperationContext } from "./transport";
import { validateTasksTransportPage } from "./validate-envelope";
import type {
  Bitrix24OperationContext,
  Bitrix24TaskListResult,
  Bitrix24TransportResult,
  Bitrix24WebhookConfig,
} from "./types";
import { parseBitrixUserId } from "./parse-id";

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

export type ReadBitrixTasksResult =
  | { ok: true; data: Bitrix24TaskListResult }
  | { ok: false; code: string; message: string; transport?: Bitrix24TransportResult };

export type ReadBitrixTasksOptions = {
  operation?: Bitrix24OperationContext;
  startedAtMs?: number;
  maxPages?: number;
};

export async function readBitrixTasksForUser(
  config: Bitrix24WebhookConfig,
  bitrixUserId: string,
  options: ReadBitrixTasksOptions = {},
): Promise<ReadBitrixTasksResult> {
  const parsedId = parseBitrixUserId(bitrixUserId);
  if (!parsedId) {
    return {
      ok: false,
      code: "INVALID_USER_ID",
      message: SAFE_READ_MESSAGES.INVALID_USER_ID,
    };
  }

  const operation =
    options.operation ?? createOperationContext(config, options.startedAtMs);
  const maxPages = options.maxPages ?? config.maxPages;
  const tasks = [];
  let pagesFetched = 0;
  let totalReported: number | null = null;
  let start = 0;
  let truncatedReason: Bitrix24TaskListResult["truncatedReason"];
  let previousFirstTaskId: string | undefined;
  let lastNext: number | null = null;
  let rejectedTaskCount = 0;
  let paginationObserved = false;
  let fieldsValidatedOnSample = false;

  while (true) {
    if (pagesFetched >= maxPages) {
      if (lastNext !== null) {
        truncatedReason = "MAX_PAGES";
      }
      break;
    }

    if (operation.deadline.expired()) {
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
      { operation },
    );

    if (!transport.ok) {
      return {
        ok: false,
        code: transport.code,
        message: transport.message,
        transport,
      };
    }

    const page = validateTasksTransportPage(transport);
    if (!page.ok) {
      return {
        ok: false,
        code: "INVALID_ENVELOPE",
        message: SAFE_READ_MESSAGES.INVALID_ENVELOPE,
        transport,
      };
    }

    pagesFetched += 1;
    totalReported = page.pagination.total ?? totalReported;
    lastNext = page.pagination.next;
    if (page.pagination.next !== null) {
      paginationObserved = true;
    }

    let normalizedOnPage = 0;
    for (const rawTask of page.tasks) {
      const normalized = normalizeBitrixTask(config.portalHost, rawTask);
      if (!normalized) {
        rejectedTaskCount += 1;
        continue;
      }
      normalizedOnPage += 1;
      tasks.push(normalized);
    }

    if (normalizedOnPage > 0) {
      fieldsValidatedOnSample = true;
    }

    if (page.tasks.length === 0 && page.pagination.next !== null) {
      truncatedReason = "EMPTY_PAGE_WITH_NEXT";
      break;
    }

    if (page.tasks.length > 0 && normalizedOnPage === 0) {
      truncatedReason = "INVALID_RECORDS";
      break;
    }

    if (normalizedOnPage === 0) {
      break;
    }

    const firstTaskId = tasks[tasks.length - normalizedOnPage]?.taskId;
    if (firstTaskId && firstTaskId === previousFirstTaskId) {
      truncatedReason = "DUPLICATE_CURSOR";
      break;
    }
    previousFirstTaskId = firstTaskId;

    if (page.pagination.next === null) {
      break;
    }
    if (page.pagination.next <= start) {
      truncatedReason = "INVALID_PAGE";
      break;
    }
    start = page.pagination.next;
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
      rejectedTaskCount,
      paginationObserved,
      fieldsValidatedOnSample,
    },
  };
}
