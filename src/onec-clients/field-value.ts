export type FieldPresence<T> =
  | { kind: "missing" }
  | { kind: "null_value" }
  | { kind: "empty" }
  | { kind: "value"; value: T }
  | { kind: "invalid_type" };

export function readStringField(value: unknown): FieldPresence<string> {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid_type" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }
  return { kind: "value", value: trimmed };
}

export function readOptionalStringField(value: unknown): FieldPresence<string> {
  const parsed = readStringField(value);
  if (parsed.kind === "missing" || parsed.kind === "null_value" || parsed.kind === "empty") {
    return parsed;
  }
  if (parsed.kind === "invalid_type") {
    return parsed;
  }
  return parsed;
}

export function readStrictBooleanField(value: unknown): FieldPresence<boolean> {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value === "boolean") {
    return { kind: "value", value };
  }
  return { kind: "invalid_type" };
}

export function readScalarField(value: unknown): FieldPresence<string | number | boolean> {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { kind: "empty" };
    }
    return { kind: "value", value: trimmed };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { kind: "value", value };
  }
  if (typeof value === "boolean") {
    return { kind: "value", value };
  }
  return { kind: "invalid_type" };
}

export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function readCalendarDateField(value: unknown): FieldPresence<string> {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid_type" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }
  if (!isValidCalendarDate(trimmed)) {
    return { kind: "invalid_type" };
  }
  return { kind: "value", value: trimmed };
}

/** Local time without invented timezone, e.g. 09:00 or 09:00:00 */
export function isValidLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

/** Canonical HH:mm for business comparison; HH:mm:00 collapses to HH:mm. */
export function normalizeLocalTimeForComparison(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (!match) {
    return value;
  }
  const seconds = match[3];
  if (seconds === undefined || seconds === "00") {
    return `${match[1]}:${match[2]}`;
  }
  return `${match[1]}:${match[2]}:${seconds}`;
}

export function readLocalTimeField(value: unknown): FieldPresence<string> {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid_type" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }
  if (!isValidLocalTime(trimmed)) {
    return { kind: "invalid_type" };
  }
  return { kind: "value", value: trimmed };
}

export type LoadingTimeFieldPresence =
  | { kind: "missing" }
  | { kind: "null_value" }
  | { kind: "empty" }
  | { kind: "value"; value: string; sourceRaw?: string }
  | { kind: "ambiguous"; sourceRaw?: string }
  | { kind: "invalid_type" };

const LOADING_TIME_ISO_PREFIX = /^0001-01-01T(\d{2}):(\d{2}):(\d{2})$/;

export function readLoadingTimeField(value: unknown): LoadingTimeFieldPresence {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid_type" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }
  const sourceRaw = trimmed;

  if (isValidLocalTime(trimmed)) {
    return { kind: "value", value: trimmed, sourceRaw };
  }

  const isoMatch = LOADING_TIME_ISO_PREFIX.exec(trimmed);
  if (isoMatch) {
    const hours = isoMatch[1]!;
    const minutes = isoMatch[2]!;
    const seconds = isoMatch[3]!;
    if (hours === "00" && minutes === "00" && seconds === "00") {
      return { kind: "ambiguous", sourceRaw };
    }
    const timeValue = seconds === "00" ? `${hours}:${minutes}` : `${hours}:${minutes}:${seconds}`;
    if (!isValidLocalTime(timeValue)) {
      return { kind: "invalid_type" };
    }
    return { kind: "value", value: timeValue, sourceRaw };
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return { kind: "invalid_type" };
  }

  return { kind: "invalid_type" };
}

export type DateOfBirthFieldPresence =
  | { kind: "missing" }
  | { kind: "null_value" }
  | { kind: "empty" }
  | { kind: "value"; value: string; sourceRaw?: string }
  | { kind: "explicit_empty"; sourceRaw?: string }
  | { kind: "ambiguous"; sourceRaw?: string }
  | { kind: "invalid_type" };

const DATE_OF_BIRTH_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00$/;

export function readDateOfBirthField(value: unknown): DateOfBirthFieldPresence {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid_type" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }
  const sourceRaw = trimmed;

  if (trimmed === "0001-01-01T00:00:00") {
    return { kind: "explicit_empty", sourceRaw };
  }

  if (/[Zz]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return { kind: "invalid_type" };
  }

  const midnightMatch = DATE_OF_BIRTH_MIDNIGHT.exec(trimmed);
  if (midnightMatch) {
    const datePart = midnightMatch[1]!;
    if (!isValidCalendarDate(datePart)) {
      return { kind: "invalid_type" };
    }
    return { kind: "value", value: datePart, sourceRaw };
  }

  if (trimmed.includes("T")) {
    return { kind: "invalid_type" };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { kind: "invalid_type" };
  }
  if (!isValidCalendarDate(trimmed)) {
    return { kind: "invalid_type" };
  }
  return { kind: "value", value: trimmed, sourceRaw };
}

export function readBonusField(value: unknown): FieldPresence<string> {
  if (value === undefined) {
    return { kind: "missing" };
  }
  if (value === null) {
    return { kind: "null_value" };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { kind: "empty" };
    }
    return { kind: "value", value: trimmed };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { kind: "invalid_type" };
    }
    return { kind: "value", value: String(value) };
  }
  return { kind: "invalid_type" };
}
