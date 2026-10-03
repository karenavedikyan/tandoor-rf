import { createHash } from "node:crypto";
import { isValidNonZeroUuid, normalizeUuid } from "./uuid";

export const WHOLESALE_DEPARTMENT_NAME = "Продажи ОПТ";
export const EMPLOYEES_RELATIVE_PATH = "clients/all_employees.json";

export type WholesaleEmployeeRoster = {
  wholesaleGuids: ReadonlySet<string>;
  totalRecords: number;
  wholesaleCount: number;
  sourceSha256: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readEmployeeGuid(raw: Record<string, unknown>): string | null {
  for (const key of ["guid_employee", "guid", "employee_guid"]) {
    const value = raw[key];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!isValidNonZeroUuid(trimmed)) {
      continue;
    }
    return normalizeUuid(trimmed);
  }
  return null;
}

function readDepartment(raw: Record<string, unknown>): string {
  for (const key of ["department", "subdivision", "podrazdelenie", "name_department"]) {
    const value = raw[key];
    if (typeof value === "string") {
      return value.trim();
    }
  }
  return "";
}

/** Parse `all_employees.json` and collect GUIDs from the wholesale department roster. */
export function parseWholesaleEmployeeRosterBytes(bytes: Buffer): WholesaleEmployeeRoster | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const wholesaleGuids = new Set<string>();
  for (const item of parsed) {
    if (!isPlainObject(item)) {
      continue;
    }
    const guid = readEmployeeGuid(item);
    if (!guid) {
      continue;
    }
    if (readDepartment(item) === WHOLESALE_DEPARTMENT_NAME) {
      wholesaleGuids.add(guid);
    }
  }

  return {
    wholesaleGuids,
    totalRecords: parsed.length,
    wholesaleCount: wholesaleGuids.size,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
