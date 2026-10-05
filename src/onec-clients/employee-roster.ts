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

function readOptionalUuid(raw: Record<string, unknown>, key: string): string | null {
  const value = readOptionalString(raw, key);
  if (!value || !isValidNonZeroUuid(value)) {
    return null;
  }
  return normalizeUuid(value);
}

function readDateOfAssumption(raw: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, "date_of_assumption")) {
    return null;
  }
  const value = raw.date_of_assumption;
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = parseCalendarDateInput(value);
  if (!parsed.ok) {
    return null;
  }
  return calendarDateToTimestamptz(parsed.isoDate);
}

function toEmployeeRecord(raw: Record<string, unknown>, guid: string): WholesaleEmployeeRecord {
  return {
    guidManager: guid,
    nameManager: readOptionalString(raw, "name_manager") ?? "",
    guidPost: readOptionalUuid(raw, "guid_post"),
    post: readOptionalString(raw, "post"),
    condition: readOptionalString(raw, "condition"),
    dateOfAssumption: readDateOfAssumption(raw),
    guidWorkSchedule: readOptionalUuid(raw, "guid_work_schedule"),
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
  | "DUPLICATE_GUID";

export type EmployeeRosterParseResult =
  | { ok: true; roster: WholesaleEmployeeRoster }
  | {
      ok: false;
      code: EmployeeRosterParseFailureCode;
      message: string;
      invalidRecordIndexes?: number[];
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
    records.push(toEmployeeRecord(item, guid));
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
