import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUNDLE_CLIENTS_FILE, BUNDLE_EMPLOYEES_FILE } from "../../src/onec-clean-reload/constants";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "./onec-clients-extended-fixtures";
import { wholesaleRosterWithManagers } from "./onec-clients-employee-roster-fixtures";
import { buildMinimalCatalogXmlSet, writeCatalogFixtureDir } from "./onec-catalog-fixtures";

export function buildCleanReloadBundleClientsBytes(): Buffer {
  return buildExtendedClientsFileBytes([sampleExtendedHolding(), sampleExtendedChild()]);
}

export async function writeCleanReloadBundleDir(targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, BUNDLE_CLIENTS_FILE), buildCleanReloadBundleClientsBytes());
  await writeFile(path.join(targetDir, BUNDLE_EMPLOYEES_FILE), wholesaleRosterWithManagers());
  await writeCatalogFixtureDir(targetDir, buildMinimalCatalogXmlSet());
}
