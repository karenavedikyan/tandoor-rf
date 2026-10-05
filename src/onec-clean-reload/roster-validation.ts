import { isValidNonZeroUuid, normalizeUuid } from "../onec-clients/uuid";

export type CleanReloadRosterIssue = {
  recordIndex: number;
  field: string;
  code: "MISSING_FIELD" | "INVALID_TYPE" | "INVALID_UUID" | "INVALID_DATE_FORMAT" | "EMPTY_VALUE";
};

export type CleanReloadRosterValidationResult =
  | { ok: true }
  | { ok: false; code: "INVALID_JSON" | "INVALID_ROOT" | "ROSTER_FIELD_INVALID"; issues: CleanReloadRosterIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidCalendarDate(datePart: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

/** Validates roster fields that are later cast to SQL types (clean reload boundary only). */
export function validateCleanReloadRosterSqlFields(bytes: Buffer): CleanReloadRosterValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "INVALID_JSON", issues: [] };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", issues: [] };
  }

  const issues: CleanReloadRosterIssue[] = [];

  for (let recordIndex = 0; recordIndex < parsed.length; recordIndex += 1) {
    const item = parsed[recordIndex];
    if (!isPlainObject(item)) {
      issues.push({ recordIndex, field: "record", code: "INVALID_TYPE" });
      continue;
    }

    const name = item.name_manager;
    if (typeof name !== "string" || name.trim().length === 0) {
      issues.push({
        recordIndex,
        field: "name_manager",
        code: typeof name === "string" ? "EMPTY_VALUE" : "INVALID_TYPE",
      });
    }

    validateOptionalUuidField(item, "guid_post", recordIndex, issues);
    validateOptionalUuidField(item, "guid_work_schedule", recordIndex, issues);
    validateDateOfAssumptionField(item, recordIndex, issues);
  }

  if (issues.length > 0) {
    return { ok: false, code: "ROSTER_FIELD_INVALID", issues };
  }

  return { ok: true };
}

function validateOptionalUuidField(
  item: Record<string, unknown>,
  field: string,
  recordIndex: number,
  issues: CleanReloadRosterIssue[],
): void {
  if (!Object.prototype.hasOwnProperty.call(item, field)) {
    return;
  }
  const value = item[field];
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    issues.push({ recordIndex, field, code: "INVALID_TYPE" });
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (!isValidNonZeroUuid(trimmed)) {
    issues.push({ recordIndex, field, code: "INVALID_UUID" });
  } else {
    normalizeUuid(trimmed);
  }
}

function validateDateOfAssumptionField(
  item: Record<string, unknown>,
  recordIndex: number,
  issues: CleanReloadRosterIssue[],
): void {
  if (!Object.prototype.hasOwnProperty.call(item, "date_of_assumption")) {
    return;
  }
  const value = item.date_of_assumption;
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    issues.push({ recordIndex, field: "date_of_assumption", code: "INVALID_TYPE" });
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }

  if (/[Zz]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    issues.push({ recordIndex, field: "date_of_assumption", code: "INVALID_DATE_FORMAT" });
    return;
  }

  const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (dateTimeMatch) {
    const [, datePart, hour, minute, second] = dateTimeMatch;
    if (
      !isValidCalendarDate(datePart!) ||
      Number(hour) > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59
    ) {
      issues.push({ recordIndex, field: "date_of_assumption", code: "INVALID_DATE_FORMAT" });
    }
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || !isValidCalendarDate(trimmed)) {
    issues.push({ recordIndex, field: "date_of_assumption", code: "INVALID_DATE_FORMAT" });
  }
}
