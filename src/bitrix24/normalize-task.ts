import { parseCanonicalBitrixId } from "./parse-id";
import { parseOptionalBitrixDate } from "./validate-datetime";
import type { Bitrix24NormalizedTask, Bitrix24TaskStatusLabel } from "./types";

const STATUS_LABELS: Record<number, Bitrix24TaskStatusLabel> = {
  2: "waiting",
  3: "in_progress",
  4: "awaiting_control",
  5: "completed",
  6: "deferred",
};

function readField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
    const lower = key.toLowerCase();
    if (lower in record) {
      return record[lower];
    }
    const upper = key.toUpperCase();
    if (upper in record) {
      return record[upper];
    }
  }
  return undefined;
}

function readRequiredTitle(record: Record<string, unknown>): string | null {
  const value = readField(record, ["TITLE", "title"]);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasStatusField(record: Record<string, unknown>): boolean {
  return (
    readField(record, ["REAL_STATUS", "realStatus"]) !== undefined ||
    readField(record, ["STATUS", "status"]) !== undefined
  );
}

function readStatusRaw(record: Record<string, unknown>): string | number | null {
  const realStatus = readField(record, ["REAL_STATUS", "realStatus"]);
  if (realStatus !== null && realStatus !== undefined) {
    if (typeof realStatus === "number" || typeof realStatus === "string") {
      return realStatus;
    }
    return null;
  }

  const status = readField(record, ["STATUS", "status"]);
  if (status !== null && status !== undefined) {
    if (typeof status === "number" || typeof status === "string") {
      return status;
    }
  }
  return null;
}

export function mapBitrixTaskStatus(statusRaw: string | number | null): Bitrix24TaskStatusLabel {
  if (statusRaw === null) {
    return "unknown";
  }
  if (typeof statusRaw === "string" && !/^\d+$/.test(statusRaw.trim())) {
    return "unknown";
  }
  const numeric = typeof statusRaw === "number" ? statusRaw : Number(statusRaw);
  if (!Number.isInteger(numeric)) {
    return "unknown";
  }
  return STATUS_LABELS[numeric] ?? "unknown";
}

export function normalizeBitrixTask(
  portalHost: string,
  raw: unknown,
): Bitrix24NormalizedTask | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const taskId = parseCanonicalBitrixId(readField(record, ["ID", "id"]));
  if (!taskId) {
    return null;
  }

  const title = readRequiredTitle(record);
  if (!title) {
    return null;
  }

  if (!hasStatusField(record)) {
    return null;
  }

  const responsibleId = parseCanonicalBitrixId(readField(record, ["RESPONSIBLE_ID", "responsibleId"]));
  if (!responsibleId) {
    return null;
  }

  const createdById = parseCanonicalBitrixId(readField(record, ["CREATED_BY", "createdBy"]));
  if (!createdById) {
    return null;
  }

  const deadlineParsed = parseOptionalBitrixDate(readField(record, ["DEADLINE", "deadline"]));
  const changedParsed = parseOptionalBitrixDate(readField(record, ["CHANGED_DATE", "changedDate"]));
  if (deadlineParsed.kind === "invalid" || changedParsed.kind !== "valid") {
    return null;
  }

  const statusRaw = readStatusRaw(record);

  return {
    portalHost,
    taskId,
    title,
    statusRaw,
    statusLabel: mapBitrixTaskStatus(statusRaw),
    responsibleId,
    createdById,
    deadline: deadlineParsed.kind === "valid" ? deadlineParsed.value : null,
    deadlineInvalid: false,
    changedAt: changedParsed.value,
    changedAtInvalid: false,
  };
}

export function dedupeBitrixTasks(tasks: Bitrix24NormalizedTask[]): Bitrix24NormalizedTask[] {
  const seen = new Set<string>();
  const deduped: Bitrix24NormalizedTask[] = [];
  for (const task of tasks) {
    const key = `${task.portalHost}:${task.taskId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(task);
  }
  return deduped;
}
