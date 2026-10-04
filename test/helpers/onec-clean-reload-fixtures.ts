import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUNDLE_CLIENTS_FILE, BUNDLE_EMPLOYEES_FILE } from "../../src/onec-clean-reload/constants";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "./onec-clients-extended-fixtures";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
  wholesaleRosterWithManagers,
} from "./onec-clients-employee-roster-fixtures";
import { EXTENDED_FIXTURE_GUIDS } from "./onec-clients-extended-fixtures";

/** Employee in roster without assigned clients (stage-1 acceptance). */
export const UNASSIGNED_ROSTER_EMPLOYEE = "88888888-8888-4888-8888-888888888888";

export function buildCleanReloadBundleClientsBytes(): Buffer {
  return buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
}

export function buildCleanReloadBundleEmployeesBytes(): Buffer {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
      name_manager: "Synthetic Manager A",
      email: "mgr-a@example.test",
    }),
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_B, {
      name_manager: "Synthetic Manager B",
      email: "mgr-b@example.test",
    }),
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.REGIONAL, {
      name_manager: "Synthetic Regional",
      email: "regional@example.test",
    }),
    buildEmployeeRosterEntry(UNASSIGNED_ROSTER_EMPLOYEE, {
      name_manager: "Unassigned Wholesale Employee",
      email: "unassigned@example.test",
    }),
  ]);
}

export async function writeCleanReloadBundleDir(targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, BUNDLE_CLIENTS_FILE), buildCleanReloadBundleClientsBytes());
  await writeFile(path.join(targetDir, BUNDLE_EMPLOYEES_FILE), buildCleanReloadBundleEmployeesBytes());
}

export { wholesaleRosterWithManagers };
