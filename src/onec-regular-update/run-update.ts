import type { EmployeeRosterReader } from "../onec-clients/read-stable-roster";
import type { FtpReader } from "../onec-clients/ftp-read";
import type { ApplyTestHooks } from "../onec-clients/apply";
import type { ImportTriggerSource } from "../onec-clients/apply";
import type { RegularUpdateConfig } from "./config";
import type { RegularUpdateResult } from "./types";
import type { ExportManifestReader } from "./export-manifest";
import { runExchangeV3RegularUpdate } from "../onec-exchange-v3/run-update";

export type RunRegularUpdateOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  config?: RegularUpdateConfig;
  clientsReader?: FtpReader;
  rosterReader?: EmployeeRosterReader;
  manifestReader?: ExportManifestReader;
  clientsBytes?: Buffer;
  employeeRosterBytes?: Buffer;
  /** v3 bundle: all four files for tests. */
  holdingsBytes?: Buffer;
  retailBytes?: Buffer;
  manifestBytes?: Buffer;
  bundleDir?: string;
  applyTestHooks?: ApplyTestHooks;
  operatorImportJobId?: string;
  importTriggerSource?: Extract<ImportTriggerSource, "regular_update" | "regular_update_nightly">;
};

/** Regular «Обновить из 1С» path — exchange v3 (4 files). Legacy 2-file import removed. */
export async function runRegularUpdate(options: RunRegularUpdateOptions = {}): Promise<RegularUpdateResult> {
  return runExchangeV3RegularUpdate({
    env: options.env,
    argv: options.argv,
    bundleDir: options.bundleDir,
    holdingsBytes: options.holdingsBytes,
    clientsBytes: options.clientsBytes,
    retailBytes: options.retailBytes,
    employeesBytes: options.employeeRosterBytes,
  });
}

export function getRegularUpdateExitCode(result: RegularUpdateResult): number {
  return result.status === "SUCCESS" || result.status === "NO_CHANGES" ? 0 : 1;
}
