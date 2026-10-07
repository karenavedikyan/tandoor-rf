import { createHash } from "node:crypto";
import {
  calendarDateToTimestamptz,
  parseCalendarDateInput,
} from "../shared/calendar-date";
import { MAX_SOURCE_BYTES } from "./constants";
import { isValidNonZeroUuid, normalizeUuid } from "./uuid";

export const EMPLOYEES_RELATIVE_PATH = "clients/all_employees.json";
export const MAX_EMPLOYEE_ROSTER_BYTES = MAX_SOURCE_BYTES;

export type WholesaleEmployeeRecord = {
  guidManager: string;
  nameManager: string;
  guidPost: string | null;
  post: string | null;
  guidTeam: string | null;
  nameTeam: string | null;
  condition: string | null;
  dateOfAssumption: string | null;
  guidWorkSchedule: string | null;
  workSchedule: string | null;
  decree: string | null;
  email: string | null;
  telephone: string | null;
  raw: Record<string, unknown>;
};

export type WholesaleEmployeeRoster = {
  wholesaleGuids: ReadonlySet<string>;
  records: readonly WholesaleEmployeeRecord[];
  totalRecords: number;
  wholesaleCount: number;
  sourceSha256: string;
  /** True when the file parsed successfully but contains zero valid wholesale employees. */
  isEmpty: boolean;
};

function readOptionalString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalStringField(
  raw: Record<string, unknown>,
  key: string,
  issues: RosterFieldIssue[],
): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) {
    return null;
  }
  const value = raw[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ field: key, code: "INVALID_TYPE" });
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type RosterFieldIssue = {
  field: string;
  code: "INVALID_TYPE" | "INVALID_UUID" | "INVALID_DATE_FORMAT";
};

function validateOptionalUuidField(
  raw: Record<string, unknown>,
  key: string,
  issues: RosterFieldIssue[],
): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) {
    return null;
  }
  const value = raw[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ field: key, code: "INVALID_TYPE" });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!isValidNonZeroUuid(trimmed)) {
    issues.push({ field: key, code: "INVALID_UUID" });
    return null;
  }
  return normalizeUuid(trimmed);
}

function readDateOfAssumption(raw: Record<string, unknown>, issues: RosterFieldIssue[]): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, "date_of_assumption")) {
    return null;
  }
  const value = raw.date_of_assumption;
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ field: "date_of_assumption", code: "INVALID_TYPE" });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = parseCalendarDateInput(trimmed);
  if (!parsed.ok) {
    issues.push({ field: "date_of_assumption", code: "INVALID_DATE_FORMAT" });
    return null;
  }
  return calendarDateToTimestamptz(parsed.isoDate);
}

function toEmployeeRecord(
  raw: Record<string, unknown>,
  guid: string,
  issues: RosterFieldIssue[],
): WholesaleEmployeeRecord {
  return {
    guidManager: guid,
    nameManager: readOptionalString(raw, "name_manager") ?? "",
    guidPost: validateOptionalUuidField(raw, "guid_post", issues),
    post: readOptionalString(raw, "post"),
    guidTeam: validateOptionalUuidField(raw, "guid_team", issues),
    nameTeam: readOptionalStringField(raw, "name_team", issues),
    condition: readOptionalString(raw, "condition"),
    dateOfAssumption: readDateOfAssumption(raw, issues),
    guidWorkSchedule: validateOptionalUuidField(raw, "guid_work_schedule", issues),
    workSchedule: readOptionalString(raw, "work_schedule"),
    decree: readOptionalString(raw, "decree"),
    email: readOptionalString(raw, "email"),
    telephone: readOptionalString(raw, "telephone"),
    raw,
  };
}

export type EmployeeRosterParseFailureCode =
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "INVALID_ROOT"
  | "FILE_TOO_LARGE"
  | "INVALID_RECORD"
  | "INVALID_FIELD_FORMAT"
  | "DUPLICATE_GUID";

export type EmployeeRosterFieldIssue = {
  index: number;
  field: string;
  code: "INVALID_TYPE" | "INVALID_UUID" | "INVALID_DATE_FORMAT";
};

export type EmployeeRosterParseResult =
  | { ok: true; roster: WholesaleEmployeeRoster }
  | {
      ok: false;
      code: EmployeeRosterParseFailureCode;
      message: string;
      invalidRecordIndexes?: number[];
      fieldIssues?: EmployeeRosterFieldIssue[];
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readManagerGuid(raw: Record<string, unknown>): string | null {
  const value = raw.guid_manager;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !isValidNonZeroUuid(trimmed)) {
    return null;
  }
  return normalizeUuid(trimmed);
}

/** Parse pre-filtered wholesale `all_employees.json` (department already «Продажи ОПТ»). */
export function parseWholesaleEmployeeRosterBytes(bytes: Buffer): EmployeeRosterParseResult {
  if (bytes.length > MAX_EMPLOYEE_ROSTER_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Employee roster exceeds ${MAX_EMPLOYEE_ROSTER_BYTES} bytes.`,
    };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "INVALID_UTF8", message: "Employee roster is not valid UTF-8." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "Employee roster is not valid JSON." };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      code: "INVALID_ROOT",
      message: "Employee roster root must be a JSON array.",
    };
  }

  const wholesaleGuids = new Set<string>();
  const records: WholesaleEmployeeRecord[] = [];
  const invalidRecordIndexes: number[] = [];
  const fieldIssues: EmployeeRosterFieldIssue[] = [];

  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isPlainObject(item)) {
      invalidRecordIndexes.push(index);
      continue;
    }
    const guid = readManagerGuid(item);
    if (!guid) {
      invalidRecordIndexes.push(index);
      continue;
    }
    if (wholesaleGuids.has(guid)) {
      return {
        ok: false,
        code: "DUPLICATE_GUID",
        message: `Duplicate guid_manager at roster index ${index}.`,
        invalidRecordIndexes: [index],
      };
    }
    wholesaleGuids.add(guid);
    const recordIssues: RosterFieldIssue[] = [];
    records.push(toEmployeeRecord(item, guid, recordIssues));
    for (const issue of recordIssues) {
      fieldIssues.push({ index, field: issue.field, code: issue.code });
    }
  }

  if (fieldIssues.length > 0) {
    return {
      ok: false,
      code: "INVALID_FIELD_FORMAT",
      message: `Employee roster contains ${fieldIssues.length} field format error(s).`,
      fieldIssues,
    };
  }

  if (invalidRecordIndexes.length > 0) {
    return {
      ok: false,
      code: "INVALID_RECORD",
      message: `Employee roster contains ${invalidRecordIndexes.length} invalid record(s).`,
      invalidRecordIndexes,
    };
  }

  return {
    ok: true,
    roster: {
      wholesaleGuids,
      records,
      totalRecords: parsed.length,
      wholesaleCount: wholesaleGuids.size,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      isEmpty: wholesaleGuids.size === 0,
    },
  };
}
