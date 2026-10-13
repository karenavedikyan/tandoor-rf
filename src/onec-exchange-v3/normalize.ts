import { ZERO_UUID } from "./constants";

const NULL_DATE_PREFIX = "0001-";

export function normalizeOptionalUuid(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === ZERO_UUID) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function parseRequiredUuid(raw: unknown, field: string, errors: string[]): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    errors.push(`${field}: обязательный UUID отсутствует или пуст`);
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === ZERO_UUID) {
    errors.push(`${field}: нулевой UUID`);
    return null;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    errors.push(`${field}: неверный UUID`);
    return null;
  }
  return normalized;
}

export function readString(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw;
}

export function readBoolean(raw: unknown): boolean {
  if (raw === true || raw === "true" || raw === "Да") {
    return true;
  }
  if (raw === false || raw === "false" || raw === "Нет") {
    return false;
  }
  return false;
}

export function readNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}

export function normalizeOptionalDate(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.startsWith(NULL_DATE_PREFIX)) {
    return null;
  }
  return trimmed;
}

export function readObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}
