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
  return buildExtendedClientsFileBytes([
    sampleExtendedHolding(),
    sampleExtendedChild({
      retail_outlets: [
        {
          guid_store: EXTENDED_FIXTURE_GUIDS.STORE_TWO,
          closed: true,
          holding: "Holding Alpha",
          warehouse: false,
          address: {
            store_address: "Child store",
            delivery_address: "",
            direction_of_the_route: "",
          },
          information_loading: {
            loading_on_friday: true,
            loading_time: "10:30",
          },
          managers: {
            guid_manager: EXTENDED_FIXTURE_GUIDS.MANAGER_B,
            name_manager: "Manager Two",
            guid_regional_manager: "",
            name_regional_manager: "",
            guid_hardware_manager: "",
            name_hardware_manager: "",
            guid_head_of_the_sales_department: "",
            name_head_of_the_sales_department: "",
          },
          contact_information: {
            store_phone: "",
            accountant_phone: "",
            accountant_email: "",
          },
          LPR_information: {},
          additional_information: {},
        },
      ],
    }),
  ]);
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
