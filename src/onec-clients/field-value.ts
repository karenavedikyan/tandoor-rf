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
