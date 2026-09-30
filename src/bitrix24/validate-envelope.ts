import type { Bitrix24TransportSuccess } from "./types";

export type ValidatedPagination = {
  next: number | null;
  total: number | null;
};

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function validatePaginationFields(
  next: unknown,
  total: unknown,
): ValidatedPagination | null {
  let parsedNext: number | null = null;
  if (next !== undefined && next !== null) {
    if (!isNonNegativeInteger(next)) {
      return null;
    }
    parsedNext = next;
  }

  let parsedTotal: number | null = null;
  if (total !== undefined && total !== null) {
    if (!isNonNegativeInteger(total)) {
      return null;
    }
    parsedTotal = total;
  }

  return { next: parsedNext, total: parsedTotal };
}

export function extractTasksArray(result: unknown): unknown[] | null {
  if (Array.isArray(result)) {
    return result;
  }
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (!("tasks" in record)) {
    return null;
  }
  if (!Array.isArray(record.tasks)) {
    return null;
  }
  return record.tasks;
}

export function extractUsersArray(result: unknown): unknown[] | null {
  if (Array.isArray(result)) {
    return result;
  }
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (!("users" in record) && !Array.isArray(record)) {
    if (Object.keys(record).length === 0) {
      return null;
    }
  }
  if ("users" in record) {
    if (!Array.isArray(record.users)) {
      return null;
    }
    return record.users;
  }
  return null;
}

export function validateTasksTransportPage(
  transport: Bitrix24TransportSuccess,
): { ok: true; tasks: unknown[]; pagination: ValidatedPagination } | { ok: false } {
  if (transport.result === undefined) {
    return { ok: false };
  }

  const tasks = extractTasksArray(transport.result);
  if (tasks === null) {
    return { ok: false };
  }

  const pagination = validatePaginationFields(transport.next, transport.total);
  if (!pagination) {
    return { ok: false };
  }

  return { ok: true, tasks, pagination };
}

export function validateUsersTransportPage(
  transport: Bitrix24TransportSuccess,
): { ok: true; users: unknown[]; pagination: ValidatedPagination } | { ok: false } {
  if (transport.result === undefined) {
    return { ok: false };
  }

  const users = extractUsersArray(transport.result);
  if (users === null) {
    return { ok: false };
  }

  const pagination = validatePaginationFields(transport.next, transport.total);
  if (!pagination) {
    return { ok: false };
  }

  return { ok: true, users, pagination };
}
