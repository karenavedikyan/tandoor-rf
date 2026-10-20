import type { AccessContext } from "../access/types";

const BLOCKED_KEY_PATTERN =
  /(?:^__|prototype|constructor|password|пароль|passwd|secret|token|api[_-]?key|credential|auth(?:orization)?|private[_-]?key)/i;

const MAX_OTHER_DEPTH = 6;
const MAX_OTHER_KEYS = 120;
const MAX_STRING_LENGTH = 8_000;
const MAX_ARRAY_LENGTH = 200;

/** Sensitive counterparty / service fields: not exposed in detail API except admin/full base. */
const DETAIL_RESTRICTED_OTHER_KEYS = new Set([
  "ГруппаДоступа",
  "ДатаРождения",
  "Пол",
]);

export function isBlockedClientOtherKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed.startsWith("__")) {
    return true;
  }
  return BLOCKED_KEY_PATTERN.test(trimmed);
}

function sanitizeScalar(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

export function sanitizeClientOtherValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_OTHER_DEPTH) {
    return null;
  }
  const scalar = sanitizeScalar(value);
  if (scalar !== null && (typeof scalar === "string" || typeof scalar === "number" || typeof scalar === "boolean")) {
    return scalar;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeClientOtherValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isBlockedClientOtherKey(key)) {
        continue;
      }
      if (count >= MAX_OTHER_KEYS) {
        break;
      }
      const sanitized = sanitizeClientOtherValue(nested, depth + 1);
      if (sanitized !== undefined) {
        out[key] = sanitized;
        count += 1;
      }
    }
    return out;
  }
  return null;
}

export function sanitizeClientOtherFields(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (isBlockedClientOtherKey(key)) {
      continue;
    }
    if (count >= MAX_OTHER_KEYS) {
      break;
    }
    const sanitized = sanitizeClientOtherValue(value, 0);
    if (sanitized !== undefined) {
      result[key] = sanitized;
      count += 1;
    }
  }
  return result;
}

export function canViewRestrictedLegalOtherFields(context: AccessContext): boolean {
  return context.role === "admin" || context.role === "director" || Boolean(context.fullClientBase);
}

export function presentLegalOtherFieldsForApi(
  raw: Record<string, unknown> | null | undefined,
  context: AccessContext,
): Record<string, unknown> {
  const sanitized = sanitizeClientOtherFields(raw);
  if (canViewRestrictedLegalOtherFields(context)) {
    return sanitized;
  }
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    if (DETAIL_RESTRICTED_OTHER_KEYS.has(key)) {
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
}
