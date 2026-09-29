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

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  const value = readField(record, keys);
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function readStatusRaw(record: Record<string, unknown>): string | number | null {
  const value = readField(record, ["REAL_STATUS", "STATUS", "status", "realStatus"]);
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return null;
}

export function mapBitrixTaskStatus(statusRaw: string | number | null): Bitrix24TaskStatusLabel {
  if (statusRaw === null) {
    return "unknown";
  }
  const numeric = typeof statusRaw === "number" ? statusRaw : Number(statusRaw);
  if (!Number.isFinite(numeric)) {
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
  const taskId = readString(record, ["ID", "id"]);
  if (!taskId) {
    return null;
  }

  const statusRaw = readStatusRaw(record);

  return {
    portalHost,
    taskId,
    title: readString(record, ["TITLE", "title"]) ?? "",
    statusRaw,
    statusLabel: mapBitrixTaskStatus(statusRaw),
    responsibleId: readString(record, ["RESPONSIBLE_ID", "responsibleId"]),
    createdById: readString(record, ["CREATED_BY", "createdBy"]),
    deadline: readString(record, ["DEADLINE", "deadline"]),
    changedAt: readString(record, ["CHANGED_DATE", "changedDate"]),
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
