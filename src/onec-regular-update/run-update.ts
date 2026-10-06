import { getDatabaseUrl } from "../config";
import { applyClientsImport, type ApplyTestHooks } from "../onec-clients/apply";
import type { EmployeeRosterReader } from "../onec-clients/read-stable-roster";
import { readStableImportBundle } from "../onec-clients/read-stable-bundle";
import type { FtpReader } from "../onec-clients/ftp-read";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { PLAIN_FTP_TRANSPORT_WARNING } from "../onec-clients/sanitize";
import { loadRegularUpdateConfig, type RegularUpdateConfig } from "./config";
import { parseRegularUpdateCliArgs, REGULAR_UPDATE_CLI_ERRORS } from "./cli-args";
import type { ImportTriggerSource } from "../onec-clients/apply";
import type { RegularUpdateResult } from "./types";
import {
  loadVerifiedExportManifest,
  type ExportManifestReader,
  type ExportManifestVerificationResult,
} from "./export-manifest";
const RELEASE_NOT_CONFIRMED_MESSAGE =
  "Структура файлов проверена. Согласованность выпуска не подтверждена: требуется export_bundle_manifest.json с export_batch_id и SHA-256 обоих файлов. Применение запрещено.";

function countOutlets(payload: import("../onec-clients/types").ValidatedClientsPayload): number {
  let total = 0;
  for (const record of payload.extendedRecords ?? []) {
    total += record.retailOutlets.length;
  }
  return total;
}

function buildCounts(input: {
  clientsProcessed: number;
  outletsProcessed: number;
  employeesProcessed: number;
  clientsNew?: number;
  clientsChanged?: number;
  clientsUnchanged?: number;
  employeesNew?: number;
  employeesChanged?: number;
  employeesUnchanged?: number;
}): RegularUpdateResult["counts"] {
  return input;
}

function rejectedResult(input: Omit<RegularUpdateResult, "finishedAt" | "durationMs"> & { startedAtMs: number }): RegularUpdateResult {
  const finishedAtMs = Date.now();
  return {
    ...input,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - input.startedAtMs,
  };
}

function manifestErrorCode(result: ExportManifestVerificationResult & { ok: false }): string {
  return result.code;
}

export type RunRegularUpdateOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  config?: RegularUpdateConfig;
  clientsReader?: FtpReader;
  rosterReader?: EmployeeRosterReader;
  manifestReader?: ExportManifestReader;
  clientsBytes?: Buffer;
  employeeRosterBytes?: Buffer;
  manifestBytes?: Buffer;
  applyTestHooks?: ApplyTestHooks;
  /** Admin regular-update job id; validated under import lock before writes. */
  operatorImportJobId?: string;
  importTriggerSource?: Extract<ImportTriggerSource, "regular_update" | "regular_update_nightly">;
};

export async function runRegularUpdate(options: RunRegularUpdateOptions = {}): Promise<RegularUpdateResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const env = options.env ?? process.env;
  const config = options.config ?? loadRegularUpdateConfig(env);

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

  let bundleRead = await readStableImportBundle(loadedConfig.config, {
    clientsReader: options.clientsBytes
      ? async () => ({ ok: true as const, bytes: options.clientsBytes!, remotePath: "/test/clients/all_clients.json" })
      : options.clientsReader,
    rosterReader: options.employeeRosterBytes
      ? async () => ({ ok: true as const, bytes: options.employeeRosterBytes! })
      : options.rosterReader,
    stabilityDelayMs: config.stabilityDelayMs,
    readDeadlineMs: config.readDeadlineMs,
    holdingLinkValidationPolicy: config.holdingLinkValidationPolicy,
  });

  for (let attempt = 0; !bundleRead.ok && attempt < config.readRetries; attempt += 1) {
    bundleRead = await readStableImportBundle(loadedConfig.config, {
      clientsReader: options.clientsBytes
        ? async () => ({ ok: true as const, bytes: options.clientsBytes!, remotePath: "/test/clients/all_clients.json" })
        : options.clientsReader,
      rosterReader: options.employeeRosterBytes
        ? async () => ({ ok: true as const, bytes: options.employeeRosterBytes! })
        : options.rosterReader,
      stabilityDelayMs: config.stabilityDelayMs,
      readDeadlineMs: config.readDeadlineMs,
      holdingLinkValidationPolicy: config.holdingLinkValidationPolicy,
    });
  }

  if (!bundleRead.ok) {
    return rejectedResult({
      status: "REJECTED_BY_CHECKS",
      mode: cliOptions.mode,
      startedAt,
      startedAtMs,
      clientsReadCount: bundleRead.clientsReadCount,
      rosterReadCount: bundleRead.rosterReadCount,
      clientsSourceSha256: bundleRead.clientsSha256,
      employeeRosterSourceSha256: bundleRead.rosterSha256,
      sourceExportAt: null,
      releaseConsistencyConfirmed: false,
      applyPermitted: false,
      errorCode: bundleRead.code,
      message: bundleRead.message,
    });
  }

  const { clientsPayload, roster, verificationFingerprint } = bundleRead;

  const manifestVerification = await loadVerifiedExportManifest(
    loadedConfig.config,
    {
      clientsSha256: clientsPayload.sha256,
      employeeRosterSha256: roster.sourceSha256,
    },
    {
      reader: options.manifestReader,
      manifestBytes: options.manifestBytes,
      readDeadlineMs: config.readDeadlineMs,
    },
  );

  const releaseConsistencyConfirmed = manifestVerification.ok;
  const exportBatchId = manifestVerification.ok ? manifestVerification.manifest.exportBatchId : null;
  const sourceExportAt = manifestVerification.ok ? manifestVerification.manifest.exportFormedAt : null;
  const applyPermitted = releaseConsistencyConfirmed;

  const baseResult = {
    verificationFingerprint,
    clientsSourceSha256: clientsPayload.sha256,
    employeeRosterSourceSha256: roster.sourceSha256,
    exportBatchId,
    sourceExportAt,
    releaseConsistencyConfirmed,
    applyPermitted,
    clientsReadCount: bundleRead.clientsReadCount,
    rosterReadCount: bundleRead.rosterReadCount,
    counts: buildCounts({
      clientsProcessed: clientsPayload.recordCount,
      outletsProcessed: countOutlets(clientsPayload),
      employeesProcessed: roster.wholesaleCount,
    }),
  };

  if (!manifestVerification.ok && manifestVerification.code !== "MANIFEST_NOT_FOUND" && manifestVerification.code !== "MANIFEST_UNREADABLE") {
    return rejectedResult({
      status: "REJECTED_BY_CHECKS",
      mode: cliOptions.mode,
      startedAt,
      startedAtMs,
      ...baseResult,
      releaseConsistencyConfirmed: false,
      applyPermitted: false,
      errorCode: manifestErrorCode(manifestVerification),
      message: manifestVerification.message,
    });
  }

  if (cliOptions.mode === "dry_run") {
    return rejectedResult({
      status: "SUCCESS",
      mode: "dry_run",
      startedAt,
      startedAtMs,
      ...baseResult,
      message: releaseConsistencyConfirmed
        ? `Regular update bundle verified; export batch ${exportBatchId} confirmed (${PLAIN_FTP_TRANSPORT_WARNING.trim()}). Apply requires matching --expected-fingerprint from this dry-run.`
        : RELEASE_NOT_CONFIRMED_MESSAGE,
    });
  }

  if (!releaseConsistencyConfirmed) {
    return rejectedResult({
      status: "REJECTED_BY_CHECKS",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...baseResult,
      errorCode: "RELEASE_CONSISTENCY_NOT_CONFIRMED",
      message: RELEASE_NOT_CONFIRMED_MESSAGE,
    });
  }

  const databaseUrl = env.DATABASE_URL?.trim() || getDatabaseUrl();
  if (!databaseUrl) {
    return rejectedResult({
      status: "ERROR",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...baseResult,
      errorCode: "DATABASE_ERROR",
      message: "DATABASE_URL is required for apply mode.",
    });
  }

  const applied = await applyClientsImport({
    databaseUrl,
    payload: clientsPayload,
    triggerSource: options.importTriggerSource ?? "regular_update",
    expectedVerificationFingerprint: cliOptions.expectedFingerprint!,
    employeeRosterSourceSha256: clientsPayload.employeeRosterSourceSha256 ?? null,
    wholesaleEmployeeRoster: roster,
    syncExchangeState: true,
    operatorImportJobId: options.operatorImportJobId,
    testHooks: options.applyTestHooks,
  });

  if (applied.ok && applied.unchangedBundle) {
    return rejectedResult({
      status: "NO_CHANGES",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...baseResult,
      message: "Bundle verification fingerprint matches the last successful apply; no changes applied.",
    });
  }

  if (!applied.ok) {
    const rejectedCodes = new Set([
      "RECORD_COUNT_DECREASED",
      "GUID_SET_SHRINK",
      "ROSTER_SHRINK_AMBIGUOUS",
      "VERIFICATION_FINGERPRINT_MISMATCH",
      "VERIFICATION_FINGERPRINT_REQUIRED",
      "VERIFICATION_PARAMETERS_MISMATCH",
      "APPLY_BLOCKED",
      "STALE_RUNNING_IMPORT",
      "IMPORT_LOCKED",
    ]);
    return rejectedResult({
      status: rejectedCodes.has(applied.code) ? "REJECTED_BY_CHECKS" : "ERROR",
      mode: "apply",
      startedAt,
      startedAtMs,
      ...baseResult,
      applyRunId: applied.runId,
      errorCode: applied.code,
      message: applied.message,
    });
  }

  return rejectedResult({
    status: "SUCCESS",
    mode: "apply",
    startedAt,
    startedAtMs,
    ...baseResult,
    applyRunId: applied.runId,
    counts: buildCounts({
      clientsProcessed: clientsPayload.recordCount,
      outletsProcessed: countOutlets(clientsPayload),
      employeesProcessed: roster.wholesaleCount,
      clientsNew: applied.counts.newCount,
      clientsChanged: applied.counts.changedCount,
      clientsUnchanged: applied.counts.unchangedCount,
      employeesNew: applied.counts.rosterNewCount,
      employeesChanged: applied.counts.rosterChangedCount,
      employeesUnchanged: applied.counts.rosterUnchangedCount,
    }),
    cleanupWarning: applied.cleanupWarning,
    message: "Regular update bundle applied successfully.",
  });
}

export function getRegularUpdateExitCode(result: RegularUpdateResult): number {
  return result.status === "SUCCESS" || result.status === "NO_CHANGES" ? 0 : 1;
}
