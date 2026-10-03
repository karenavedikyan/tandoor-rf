import { createHash } from "node:crypto";
import { MAX_SOURCE_BYTES } from "./constants";
import { isValidNonZeroUuid, normalizeUuid } from "./uuid";

export const EMPLOYEES_RELATIVE_PATH = "clients/all_employees.json";
export const MAX_EMPLOYEE_ROSTER_BYTES = MAX_SOURCE_BYTES;

export type WholesaleEmployeeRoster = {
  wholesaleGuids: ReadonlySet<string>;
  totalRecords: number;
  wholesaleCount: number;
  sourceSha256: string;
  /** True when the file parsed successfully but contains zero valid wholesale employees. */
  isEmpty: boolean;
};

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
      totalRecords: parsed.length,
      wholesaleCount: wholesaleGuids.size,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      isEmpty: wholesaleGuids.size === 0,
    },
  };
}
