import {
  dedupeChecklistItems,
  normalizeChecklistItem,
  type NormalizedChecklistItem,
} from "./normalize-checklist";
import { parseCanonicalBitrixId } from "./parse-id";
import { SAFE_READ_MESSAGES } from "./safe-errors";
import { callBitrix24Method, createOperationContext } from "./transport";
import { validateChecklistTransportPage } from "./validate-envelope";
import type { Bitrix24OperationContext, Bitrix24WebhookConfig } from "./types";

export type Bitrix24ChecklistListResult = {
  items: NormalizedChecklistItem[];
  pagesFetched: number;
  complete: boolean;
  truncatedReason?: "MAX_PAGES" | "MAX_DURATION" | "INVALID_RECORDS" | "EMPTY_PAGE_WITH_NEXT" | "INVALID_PAGE" | "DUPLICATE_CURSOR" | "TOTAL_MISMATCH";
  rejectedItemCount: number;
  paginationObserved: boolean;
};

export type ReadBitrixChecklistResult =
  | { ok: true; data: Bitrix24ChecklistListResult }
  | { ok: false; code: string; message: string };

export type ReadBitrixChecklistOptions = {
  operation?: Bitrix24OperationContext;
  startedAtMs?: number;
  maxPages?: number;
};

function finalizeChecklistResult(input: {
  items: NormalizedChecklistItem[];
  pagesFetched: number;
  truncatedReason?: Bitrix24ChecklistListResult["truncatedReason"];
  rejectedItemCount: number;
  paginationObserved: boolean;
  totalReported: number | null;
  lastNext: number | null;
}): Bitrix24ChecklistListResult {
  let truncatedReason = input.truncatedReason;
  if (truncatedReason === undefined && input.rejectedItemCount > 0) {
    truncatedReason = "INVALID_RECORDS";
  }
  if (
    truncatedReason === undefined &&
    input.lastNext === null &&
    input.totalReported !== null &&
    input.totalReported !== input.items.length
  ) {
    truncatedReason = "TOTAL_MISMATCH";
  }
  return {
    items: input.items,
    pagesFetched: input.pagesFetched,
    complete: truncatedReason === undefined,
    truncatedReason,
    rejectedItemCount: input.rejectedItemCount,
    paginationObserved: input.paginationObserved,
  };
}

export async function readBitrixChecklistForTask(
  config: Bitrix24WebhookConfig,
  taskId: string,
  options: ReadBitrixChecklistOptions = {},
): Promise<ReadBitrixChecklistResult> {
  const parsedTaskId = parseCanonicalBitrixId(taskId);
  if (!parsedTaskId) {
    return { ok: false, code: "INVALID_TASK_ID", message: "Invalid task ID." };
  }

  const operation =
    options.operation ?? createOperationContext(config, options.startedAtMs);
  const maxPages = options.maxPages ?? config.maxPages;
  const items: NormalizedChecklistItem[] = [];
  let pagesFetched = 0;
  let totalReported: number | null = null;
  let start = 0;
  let truncatedReason: Bitrix24ChecklistListResult["truncatedReason"];
  let previousFirstItemId: string | undefined;
  let lastNext: number | null = null;
  let rejectedItemCount = 0;
  let paginationObserved = false;

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
      "task.checklistitem.getlist",
      {
        TASKID: Number(parsedTaskId),
        ORDER: { SORT_INDEX: "ASC", ID: "ASC" },
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

    const page = validateChecklistTransportPage(transport);
    if (!page.ok) {
      return {
        ok: false,
        code: "INVALID_ENVELOPE",
        message: SAFE_READ_MESSAGES.INVALID_ENVELOPE,
      };
    }

    pagesFetched += 1;
    totalReported = page.pagination.total ?? totalReported;
    lastNext = page.pagination.next;
    if (page.pagination.next !== null) {
      paginationObserved = true;
    }

    let normalizedOnPage = 0;
    for (const rawItem of page.items) {
      const normalized = normalizeChecklistItem(rawItem);
      if (!normalized) {
        rejectedItemCount += 1;
        continue;
      }
      normalizedOnPage += 1;
      items.push(normalized);
    }

    if (page.items.length === 0 && page.pagination.next !== null) {
      truncatedReason = "EMPTY_PAGE_WITH_NEXT";
      break;
    }

    if (page.items.length > 0 && normalizedOnPage === 0) {
      truncatedReason = "INVALID_RECORDS";
      break;
    }

    if (normalizedOnPage === 0) {
      break;
    }

    const firstItemId = items[items.length - normalizedOnPage]?.itemId;
    if (firstItemId && firstItemId === previousFirstItemId) {
      truncatedReason = "DUPLICATE_CURSOR";
      break;
    }
    previousFirstItemId = firstItemId;

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
    data: finalizeChecklistResult({
      items: dedupeChecklistItems(items),
      pagesFetched,
      truncatedReason,
      rejectedItemCount,
      paginationObserved,
      totalReported,
      lastNext,
    }),
  };
}
