import type { Bitrix24NormalizedUser } from "./types";

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

export function normalizeBitrixUser(
  portalHost: string,
  raw: unknown,
): Bitrix24NormalizedUser | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const bitrixUserId = readString(record, ["ID", "id"]);
  if (!bitrixUserId) {
    return null;
  }

  const activeRaw = readField(record, ["ACTIVE", "active"]);
  let active: boolean | null = null;
  if (typeof activeRaw === "boolean") {
    active = activeRaw;
  } else if (typeof activeRaw === "string") {
    const normalized = activeRaw.trim().toUpperCase();
    if (normalized === "Y" || normalized === "TRUE") {
      active = true;
    } else if (normalized === "N" || normalized === "FALSE") {
      active = false;
    }
  }

  return {
    portalHost,
    bitrixUserId,
    active,
  };
}
