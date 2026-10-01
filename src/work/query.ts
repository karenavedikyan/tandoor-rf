import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH, MIN_PAGE } from "../clients/constants";
import { isValidUuidParam } from "../clients/uuid-param";
import type { DeadlineGroup } from "./deadline-groups";

export type WorkStatusFilter = "open" | "completed" | "all";

export type WorkListQuery = {
  q: string;
  clientGuid?: string;
  responsibleBitrixUserId?: string;
  statusLabel?: string;
  status: WorkStatusFilter;
  deadlineGroup?: DeadlineGroup;
  page: number;
  pageSize: number;
};

export type ParsedWorkListQuery =
  | { ok: true; query: WorkListQuery }
  | { ok: false; message: string };

const DEADLINE_GROUPS = new Set<DeadlineGroup>([
  "overdue",
  "today",
  "upcoming",
  "no_deadline",
  "completed",
]);

function rejectNonScalar(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === "object");
}

function parseScalarString(value: unknown, fallback: string): string | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    return null;
  }
  return value.trim();
}

function parsePositiveInt(value: unknown, fallback: number, max?: number): number | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (rejectNonScalar(value)) {
    return null;
  }
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) {
    return null;
  }
  const parsed = Number(str);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_PAGE) {
    return null;
  }
  if (max !== undefined && parsed > max) {
    return null;
  }
  return parsed;
}

function parseOptionalUuid(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (rejectNonScalar(value) || typeof value !== "string" || !isValidUuidParam(value)) {
    return null;
  }
  return value.trim().toLowerCase();
}

function parseStatusFilter(value: unknown): WorkStatusFilter | null {
  const raw = parseScalarString(value, "open");
  if (raw === null) {
    return null;
  }
  if (raw === "open" || raw === "completed" || raw === "all") {
    return raw;
  }
  return null;
}

function parseDeadlineGroup(value: unknown): DeadlineGroup | undefined | null {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (rejectNonScalar(value) || typeof value !== "string") {
    return null;
  }
  const normalized = value.trim() as DeadlineGroup;
  if (!DEADLINE_GROUPS.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseWorkListQuery(input: Record<string, unknown>): ParsedWorkListQuery {
  if (rejectNonScalar(input.q)) {
    return { ok: false, message: "Некорректный параметр поиска." };
  }
  const rawQ = parseScalarString(input.q, "");
  if (rawQ === null) {
    return { ok: false, message: "Некорректный параметр поиска." };
  }
  if (rawQ.length > MAX_SEARCH_LENGTH) {
    return { ok: false, message: "Слишком длинный поисковый запрос." };
  }

  const clientGuid = parseOptionalUuid(input.clientGuid);
  if (clientGuid === null) {
    return { ok: false, message: "Некорректный clientGuid." };
  }

  const responsibleRaw = parseScalarString(input.responsibleBitrixUserId, "");
  if (responsibleRaw === null) {
    return { ok: false, message: "Некорректный responsibleBitrixUserId." };
  }
  const responsibleBitrixUserId =
    responsibleRaw.length > 0 ? responsibleRaw : undefined;
  if (responsibleBitrixUserId && !/^\d+$/.test(responsibleBitrixUserId)) {
    return { ok: false, message: "Некорректный responsibleBitrixUserId." };
  }

  const statusLabelRaw = parseScalarString(input.statusLabel, "");
  if (statusLabelRaw === null) {
    return { ok: false, message: "Некорректный statusLabel." };
  }
  const statusLabel = statusLabelRaw.length > 0 ? statusLabelRaw : undefined;

  const status = parseStatusFilter(input.status);
  if (!status) {
    return { ok: false, message: "Некорректный status." };
  }

  const deadlineGroup = parseDeadlineGroup(input.deadlineGroup);
  if (deadlineGroup === null) {
    return { ok: false, message: "Некорректный deadlineGroup." };
  }

  const page = parsePositiveInt(input.page, MIN_PAGE);
  if (page === null) {
    return { ok: false, message: "Некорректный page." };
  }

  const pageSize = parsePositiveInt(input.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: "Некорректный pageSize." };
  }

  return {
    ok: true,
    query: {
      q: rawQ,
      clientGuid,
      responsibleBitrixUserId,
      statusLabel,
      status,
      deadlineGroup,
      page,
      pageSize,
    },
  };
}
