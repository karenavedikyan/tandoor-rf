import { dedupeBitrixTasks, normalizeBitrixTask } from "./normalize-task";
import { parseBitrixUserId, parseCanonicalBitrixId } from "./parse-id";
import { SAFE_READ_MESSAGES } from "./safe-errors";
import { callBitrix24Method, createOperationContext } from "./transport";
import { validateTasksTransportPage } from "./validate-envelope";
import type {
  Bitrix24OperationContext,
  Bitrix24TaskListResult,
  Bitrix24WebhookConfig,
} from "./types";

const TASK_SELECT_FIELDS = [
  "ID",
  "TITLE",
  "STATUS",
  "REAL_STATUS",
  "RESPONSIBLE_ID",
  "CREATED_BY",
  "DEADLINE",
  "CHANGED_DATE",
  "DESCRIPTION",
] as const;

export type ReadBitrixTasksResult =
  | { ok: true; data: Bitrix24TaskListResult }
  | { ok: false; code: string; message: string };

export type ReadBitrixTasksOptions = {
  operation?: Bitrix24OperationContext;
  startedAtMs?: number;
  maxPages?: number;
  taskId?: string;
  /** Substring filter for DESCRIPTION (%DESCRIPTION in Bitrix REST). */
  descriptionContains?: string;
};

function finalizeTaskListResult(input: {
  tasks: ReturnType<typeof dedupeBitrixTasks>;
  totalReported: number | null;
  pagesFetched: number;
  truncatedReason?: Bitrix24TaskListResult["truncatedReason"];
  rejectedTaskCount: number;
  paginationObserved: boolean;
  fieldsValidatedOnSample: boolean;
  lastNext: number | null;
}): Bitrix24TaskListResult {
  let truncatedReason = input.truncatedReason;

  if (truncatedReason === undefined && input.rejectedTaskCount > 0) {
    truncatedReason = "INVALID_RECORDS";
  }

  if (
    truncatedReason === undefined &&
    input.lastNext === null &&
    input.totalReported !== null &&
    input.totalReported !== input.tasks.length
  ) {
    truncatedReason = "TOTAL_MISMATCH";
  }

  return {
    tasks: input.tasks,
    totalReported: input.totalReported,
    pagesFetched: input.pagesFetched,
    complete: truncatedReason === undefined,
    truncatedReason,
    rejectedTaskCount: input.rejectedTaskCount,
    paginationObserved: input.paginationObserved,
    fieldsValidatedOnSample: input.fieldsValidatedOnSample,
  };
}

export async function readBitrixTasksForUser(
  config: Bitrix24WebhookConfig,
  bitrixUserId: string,
  options: ReadBitrixTasksOptions = {},
): Promise<ReadBitrixTasksResult> {
  const parsedId = parseBitrixUserId(bitrixUserId);
  const taskId = options.taskId === undefined ? undefined : parseCanonicalBitrixId(options.taskId);
  if (taskId === null) {
    return { ok: false, code: "INVALID_TASK_ID", message: "Invalid pilot task ID." };
  }
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

    const filter: Record<string, unknown> = { RESPONSIBLE_ID: parsedId };
    if (taskId) {
      filter.ID = taskId;
    }
    if (options.descriptionContains) {
      filter["%DESCRIPTION"] = options.descriptionContains;
    }
    const transport = await callBitrix24Method(
      config,
      "tasks.task.list",
      {
        order: { CHANGED_DATE: "desc" },
        filter,
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
      };
    }

    const page = validateTasksTransportPage(transport);
    if (!page.ok) {
      return {
        ok: false,
        code: "INVALID_ENVELOPE",
        message: SAFE_READ_MESSAGES.INVALID_ENVELOPE,
      };
    }

    // A scoped pilot must never fall back to caching the employee's task list.
    if (taskId && (
      page.tasks.length > 1 ||
      page.pagination.next !== null ||
      (page.pagination.total !== null && page.pagination.total !== undefined && page.pagination.total > 1)
    )) {
      return { ok: false, code: "PILOT_SCOPE_MISMATCH", message: "Pilot response exceeds the requested scope." };
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
      if (taskId && (!normalized || normalized.taskId !== taskId || normalized.responsibleId !== parsedId)) {
        return { ok: false, code: "PILOT_SCOPE_MISMATCH", message: "Pilot response does not match the requested task and employee." };
      }
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

  return {
    ok: true,
    data: finalizeTaskListResult({
      tasks: dedupeBitrixTasks(tasks),
      totalReported,
      pagesFetched,
      truncatedReason,
      rejectedTaskCount,
      paginationObserved,
      fieldsValidatedOnSample,
      lastNext,
    }),
  };
}
