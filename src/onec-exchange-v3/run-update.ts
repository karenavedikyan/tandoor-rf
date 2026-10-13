import { getDatabaseUrl } from "../config";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { PLAIN_FTP_TRANSPORT_WARNING } from "../onec-clients/sanitize";
import { parseRegularUpdateCliArgs, REGULAR_UPDATE_CLI_ERRORS } from "../onec-regular-update/cli-args";
import { loadRegularUpdateConfig } from "../onec-regular-update/config";
import type { RegularUpdateResult } from "../onec-regular-update/types";
import { applyExchangeV3Bundle } from "./apply";
import { readStableV3Bundle } from "./read-stable-bundle";
import { validateExchangeV3Bundle } from "./validate-bundle";

function rejectedResult(input: Omit<RegularUpdateResult, "finishedAt" | "durationMs"> & { startedAtMs: number }): RegularUpdateResult {
  const finishedAtMs = Date.now();
  return {
    ...input,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - input.startedAtMs,
  };
}

export type RunExchangeV3UpdateOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  bundleDir?: string;
  holdingsBytes?: Buffer;
  clientsBytes?: Buffer;
  retailBytes?: Buffer;
  employeesBytes?: Buffer;
};

const V3_RELEASE_NOTE =
  "Комплект v3 (4 файла) без export_bundle_manifest.json: согласованность между файлами не гарантируется 1С; используется стабильное чтение и SHA256 комплекта.";

export async function runExchangeV3RegularUpdate(options: RunExchangeV3UpdateOptions = {}): Promise<RegularUpdateResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const env = options.env ?? process.env;
  loadRegularUpdateConfig(env);

  const parsedArgs = parseRegularUpdateCliArgs(options.argv ?? []);
  if (!parsedArgs.ok) {
    return rejectedResult({
      status: "ERROR",
      mode: "dry_run",
      startedAt,
      startedAtMs,
      errorCode: parsedArgs.code,
      message: REGULAR_UPDATE_CLI_ERRORS[parsedArgs.code],
    });
  }
  const cliOptions = parsedArgs.options;

  let bundleBytes: import("./read-bundle").V3BundleBytes;

  if (options.bundleDir) {
    const stable = await readStableV3Bundle({ bundleDir: options.bundleDir });
    if (!stable.ok) {
      return rejectedResult({
        status: "REJECTED_BY_CHECKS",
        mode: cliOptions.mode,
        startedAt,
        startedAtMs,
        errorCode: stable.code,
        message: stable.message,
        applyPermitted: false,
      });
    }
    bundleBytes = stable.bundle;
  } else if (options.holdingsBytes && options.clientsBytes && options.retailBytes && options.employeesBytes) {
    bundleBytes = {
      holdingsBytes: options.holdingsBytes,
      clientsBytes: options.clientsBytes,
      retailBytes: options.retailBytes,
      employeesBytes: options.employeesBytes,
    };
  } else {
    const loadedConfig = loadOnecFtpConfig(env);
    if (!loadedConfig.ok) {
      return rejectedResult({
        status: "ERROR",
        mode: cliOptions.mode,
        startedAt,
        startedAtMs,
        errorCode: "CONFIG_ERROR",
        message: loadedConfig.message,
      });
    }
    const stable = await readStableV3Bundle({ ftpConfig: loadedConfig.config });
    if (!stable.ok) {
      return rejectedResult({
        status: "REJECTED_BY_CHECKS",
        mode: cliOptions.mode,
        startedAt,
        startedAtMs,
        errorCode: stable.code,
        message: stable.message,
        applyPermitted: false,
      });
    }
    bundleBytes = stable.bundle;
  }

  const validated = validateExchangeV3Bundle(bundleBytes);
  if (!validated.ok) {
    return rejectedResult({
      status: "REJECTED_BY_CHECKS",
      mode: cliOptions.mode,
      startedAt,
      startedAtMs,
      errorCode: validated.errorCode,
      message: validated.message,
      applyPermitted: false,
    });
  }

  const bundle = validated.bundle;
  const base = {
    verificationFingerprint: bundle.bundleFingerprint,
    clientsSourceSha256: bundle.fileSha256["all_clients.json"],
    employeeRosterSourceSha256: bundle.fileSha256["all_employees.json"],
    exportBatchId: null,
    sourceExportAt: null,
    releaseConsistencyConfirmed: false,
    applyPermitted: true,
    clientsReadCount: bundle.legalEntities.length,
    rosterReadCount: bundle.employeeRoster.totalRecords,
    counts: {
      clientsProcessed: bundle.legalEntities.length,
      outletsProcessed: bundle.retailOutlets.length,
      employeesProcessed: bundle.employeeRoster.wholesaleCount,
    },
  };

  if (cliOptions.mode === "dry_run") {
    return rejectedResult({
      status: "SUCCESS",
      mode: "dry_run",
      startedAt,
      startedAtMs,
      ...base,
      message: `Exchange v3 bundle verified (${PLAIN_FTP_TRANSPORT_WARNING.trim()}). ${V3_RELEASE_NOTE} Apply requires --expected-fingerprint=${bundle.bundleFingerprint}.`,
    });
  }

  if (!getDatabaseUrl() && !env.DATABASE_URL?.trim()) {
    return rejectedResult({
      status: "ERROR",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...base,
      errorCode: "DATABASE_ERROR",
      message: "DATABASE_URL is required for apply mode.",
    });
  }

  if (!cliOptions.expectedFingerprint) {
    return rejectedResult({
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...base,
      errorCode: "VERIFICATION_FINGERPRINT_REQUIRED",
      message: "Apply requires --expected-fingerprint from dry-run.",
    });
  }

  const applied = await applyExchangeV3Bundle({
    bundle,
    mode: "apply",
    expectedFingerprint: cliOptions.expectedFingerprint,
  });

  if (!applied.ok) {
    return rejectedResult({
      status: applied.errorCode === "FINGERPRINT_MISMATCH" ? "REJECTED_BY_CHECKS" : "ERROR",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...base,
      errorCode: applied.errorCode,
      message: applied.message,
    });
  }

  if (applied.unchanged) {
    return rejectedResult({
      status: "NO_CHANGES",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...base,
      message: "Bundle fingerprint matches last successful apply; no changes.",
    });
  }

  return rejectedResult({
    status: "SUCCESS",
    mode: "apply",
    startedAt,
    startedAtMs,
    ...base,
    counts: {
      ...base.counts,
      clientsNew: bundle.legalEntities.length,
      outletsProcessed: bundle.retailOutlets.length,
    },
    message: "Exchange v3 bundle applied successfully.",
  });
}
