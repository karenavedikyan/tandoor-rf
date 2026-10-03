import { WHOLESALE_DEPARTMENT_NAME } from "../../src/onec-clients/employee-roster";
import { EXTENDED_FIXTURE_GUIDS } from "./onec-clients-extended-fixtures";

export function buildEmployeeRosterBytes(
  entries: Array<{ guid: string; department?: string; name?: string }>,
): Buffer {
  return Buffer.from(
    JSON.stringify(
      entries.map((entry) => ({
        guid_employee: entry.guid,
        name_employee: entry.name ?? "Synthetic Employee",
        department: entry.department ?? WHOLESALE_DEPARTMENT_NAME,
      })),
    ),
    "utf8",
  );
}

export function wholesaleRosterWithManagers(): Buffer {
  return buildEmployeeRosterBytes([
    { guid: EXTENDED_FIXTURE_GUIDS.MANAGER_A },
    { guid: EXTENDED_FIXTURE_GUIDS.MANAGER_B },
    { guid: EXTENDED_FIXTURE_GUIDS.REGIONAL },
  ]);
}

export function wholesaleRosterWithoutUnknown(): Buffer {
  return buildEmployeeRosterBytes([
    { guid: EXTENDED_FIXTURE_GUIDS.MANAGER_A },
    { guid: EXTENDED_FIXTURE_GUIDS.REGIONAL },
  ]);
}
