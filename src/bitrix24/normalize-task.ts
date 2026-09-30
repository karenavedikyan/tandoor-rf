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

function statusKeyPresent(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    if (key in record) {
      return true;
    }
    const lower = key.toLowerCase();
    if (lower in record) {
      return true;
    }
    const upper = key.toUpperCase();
    if (upper in record) {
      return true;
    }
  }
  return false;
}

function parseStatusScalar(
  value: unknown,
): { kind: "absent" } | { kind: "valid"; value: string | number } | { kind: "invalid" } {
  if (value === null || value === undefined) {
    return { kind: "absent" };
  }
  if (typeof value === "number" || typeof value === "string") {
    return { kind: "valid", value };
  }
  return { kind: "invalid" };
}

function readStatusRaw(record: Record<string, unknown>): string | number | "reject" {
  const realPresent = statusKeyPresent(record, ["REAL_STATUS", "realStatus"]);
  const realValue = readField(record, ["REAL_STATUS", "realStatus"]);

  if (realPresent) {
    const realParsed = parseStatusScalar(realValue);
    if (realParsed.kind === "invalid") {
      return "reject";
    }
    if (realParsed.kind === "valid") {
      return realParsed.value;
    }
  }

  const statusPresent = statusKeyPresent(record, ["STATUS", "status"]);
  const statusValue = readField(record, ["STATUS", "status"]);

  if (statusPresent) {
    const statusParsed = parseStatusScalar(statusValue);
    if (statusParsed.kind === "invalid") {
      return "reject";
    }
    if (statusParsed.kind === "valid") {
      return statusParsed.value;
    }
  }

  return "reject";
}

function readRequiredTitle(record: Record<string, unknown>): string | null {
  const value = readField(record, ["TITLE", "title"]);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  const statusRaw = readStatusRaw(record);
  if (statusRaw === "reject") {
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

  const descriptionRaw = readField(record, ["DESCRIPTION", "description"]);
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : null;

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
    description,
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
