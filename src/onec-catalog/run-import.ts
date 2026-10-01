import { loadOnecFtpConfig } from "../onec-ftp/config";
import { applyCatalogImport, resolveCatalogDatabaseUrl } from "./apply";
import { CLI_ARGUMENT_ERROR_MESSAGES, parseCatalogImportCliArgs } from "./cli-args";
import {
  MAX_DETAILED_ERRORS,
  MAX_DETAILED_QUARANTINE,
  MAX_DETAILED_WARNINGS,
  type CatalogImportProfile,
} from "./constants";
import { buildManifest } from "./manifest";
import { parseCatalogSet } from "./parse-catalog-set";
import { readCatalogSetFromLocalDir } from "./read-local";
import { defaultCatalogFtpReader, readCatalogSetFromFtp, type CatalogFtpReader } from "./read-ftp";
import { readStableCatalogSet } from "./read-stable";
import { PLAIN_FTP_TRANSPORT_WARNING, sanitizeCatalogImportResult } from "./sanitize";
import type { CatalogImportResult, CatalogFileEntry } from "./types";
import { validateCatalogSet } from "./validate-catalog-set";

export function getCatalogImportExitCode(status: CatalogImportResult["status"]): number {
  return status === "SUCCESS" || status === "PARTIAL" || status === "SKIPPED_UNCHANGED" ? 0 : 1;
}

export type RunCatalogImportOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  profile?: CatalogImportProfile;
  ftpReader?: CatalogFtpReader;
  localFiles?: CatalogFileEntry[];
  skipStabilityCheck?: boolean;
};

async function readCatalogFiles(
  options: RunCatalogImportOptions,
  profile: CatalogImportProfile,
  cliLocalDir?: string,
): Promise<
  | { ok: true; files: CatalogFileEntry[]; readAt?: string }
  | { ok: false; result: CatalogImportResult }
> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;

  if (options.localFiles) {
    const manifest = buildManifest(options.localFiles, profile);
    return { ok: true, files: manifest.files, readAt: new Date().toISOString() };
  }

  if (cliLocalDir) {
    const localRead = await readCatalogSetFromLocalDir(cliLocalDir, profile);
    if (!localRead.ok) {
      return {
        ok: false,
        result: sanitizeCatalogImportResult({
          status: "VALIDATION_FAILED",
          mode: "dry_run",
          profile,
          durationMs: Date.now() - startedAt,
          errorCount: localRead.issues.length,
          errors: localRead.issues.slice(0, MAX_DETAILED_ERRORS),
          message: "Local catalog file set validation failed.",
        }),
      };
    }
    return { ok: true, files: localRead.files, readAt: new Date().toISOString() };
  }

  const loadedConfig = loadOnecFtpConfig(env);
  if (!loadedConfig.ok) {
    return {
      ok: false,
      result: sanitizeCatalogImportResult({
        status: "CONFIG_ERROR",
        mode: "dry_run",
        durationMs: Date.now() - startedAt,
        message: loadedConfig.message,
        errorCode: "CONFIG_ERROR",
      }),
    };
  }

  const reader = options.ftpReader ?? defaultCatalogFtpReader;
  const readOnce = () => readCatalogSetFromFtp(loadedConfig.config, reader, { profile });
  if (options.skipStabilityCheck) {
    const single = await readOnce();
    if (!single.ok) {
      return {
        ok: false,
        result: sanitizeCatalogImportResult({
          status: single.code === "TIMEOUT" ? "TIMEOUT" : "FTP_ERROR",
          mode: "dry_run",
          durationMs: Date.now() - startedAt,
          message: single.message,
          errorCode: single.code,
        }),
      };
    }
    return { ok: true, files: single.files, readAt: new Date().toISOString() };
  }

  const stable = await readStableCatalogSet(readOnce);
  if (!stable.ok) {
    return {
      ok: false,
      result: sanitizeCatalogImportResult({
        status: stable.code === "READ_FAILED" ? "READ_FAILED" : "UNSTABLE_SOURCE",
        mode: "dry_run",
        durationMs: Date.now() - startedAt,
        message: stable.message,
        errorCode: stable.code,
      }),
    };
  }
  return { ok: true, files: stable.files, readAt: stable.readAt };
}

export async function runCatalogImport(
  options: RunCatalogImportOptions = {},
): Promise<CatalogImportResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const argv = options.argv ?? [];

  const parsedArgs = parseCatalogImportCliArgs(argv);
  if (!parsedArgs.ok) {
    return sanitizeCatalogImportResult({
      status: "ARGUMENT_ERROR",
      mode: "dry_run",
      durationMs: Date.now() - startedAt,
      message: CLI_ARGUMENT_ERROR_MESSAGES[parsedArgs.code],
      errorCode: parsedArgs.code,
    });
  }

  const cli = parsedArgs.options;
  const profile = options.profile ?? cli.profile;
  const readResult = await readCatalogFiles(options, profile, cli.localDir);
  if (!readResult.ok) {
    return { ...readResult.result, profile };
  }

  const manifest = buildManifest(readResult.files, profile);
  const fileInputs = readResult.files.map((file) => ({
    relativePath: file.relativePath,
    bytes: file.bytes,
  }));

  const parsed = await parseCatalogSet(fileInputs, profile);
  if (!parsed.ok) {
    return sanitizeCatalogImportResult({
      status: "VALIDATION_FAILED",
      mode: cli.mode,
      profile,
      durationMs: Date.now() - startedAt,
      manifestSha256: manifest.manifestSha256,
      totalByteSize: manifest.totalByteSize,
      errorCount: parsed.issues.length,
      errors: parsed.issues,
      message: "Catalog XML validation failed.",
      readAt: readResult.readAt,
    });
  }

  const validated = validateCatalogSet(parsed.data, { profile });
  if (!validated.ok) {
    return sanitizeCatalogImportResult({
      status: "VALIDATION_FAILED",
      mode: cli.mode,
      profile,
      durationMs: Date.now() - startedAt,
      manifestSha256: manifest.manifestSha256,
      totalByteSize: manifest.totalByteSize,
      errorCount: validated.issues.length,
      errors: validated.issues,
      message: "Catalog reference validation failed.",
      readAt: readResult.readAt,
    });
  }

  const data = validated.data;
  const classificationWarningCount = data.classificationWarnings.length;
  const baseResult = {
    profile,
    manifestSha256: data.manifest.manifestSha256,
    totalByteSize: data.manifest.totalByteSize,
    counts: data.counts,
    warningCount: data.warnings.length,
    warnings: data.warnings,
    classificationWarningCount,
    classificationWarnings: data.classificationWarnings,
    classificationIncomplete: data.classificationIncomplete,
    commercialStatus: data.commercialStatus,
    quarantineCount: data.quarantine.length,
    quarantine: data.quarantine,
    coreApplied: false,
    commercialReady: false,
    distributionReady: false,
    readAt: readResult.readAt,
  };

  if (cli.mode === "dry_run") {
    const status =
      profile === "full" && data.quarantine.length > 0 ? "PARTIAL" : "SUCCESS";
    const classificationNote = data.classificationIncomplete
      ? " Classification is incomplete (missing group references preserved)."
      : "";
    return sanitizeCatalogImportResult({
      status,
      mode: "dry_run",
      durationMs: Date.now() - startedAt,
      ...baseResult,
      message:
        status === "PARTIAL"
          ? "Catalog dry-run succeeded; core catalog is valid but commercial staging contains quarantined rows."
          : `Catalog dry-run succeeded (no database changes).${classificationNote}`,
    });
  }

  if (!cli.expectedManifestSha256) {
    return sanitizeCatalogImportResult({
      status: "ARGUMENT_ERROR",
      mode: "apply",
      durationMs: Date.now() - startedAt,
      message: CLI_ARGUMENT_ERROR_MESSAGES.APPLY_REQUIRES_EXPECTED_SHA256,
      errorCode: "APPLY_REQUIRES_EXPECTED_SHA256",
    });
  }

  if (cli.expectedManifestSha256 !== data.manifest.manifestSha256) {
    return sanitizeCatalogImportResult({
      status: "HASH_MISMATCH",
      mode: "apply",
      durationMs: Date.now() - startedAt,
      manifestSha256: data.manifest.manifestSha256,
      message: "Manifest SHA-256 does not match --expected-manifest-sha256.",
      errorCode: "HASH_MISMATCH",
    });
  }

  const databaseUrl = resolveCatalogDatabaseUrl(env);
  if (!databaseUrl) {
    return sanitizeCatalogImportResult({
      status: "DATABASE_ERROR",
      mode: "apply",
      durationMs: Date.now() - startedAt,
      manifestSha256: data.manifest.manifestSha256,
      message: "DATABASE_URL is not configured.",
    });
  }

  const applied = await applyCatalogImport(databaseUrl, data, { readAt: readResult.readAt });
  if (!applied.ok) {
    const status =
      applied.code === "SKIPPED_UNCHANGED"
        ? "SKIPPED_UNCHANGED"
        : applied.code === "IMPORT_LOCKED"
          ? "IMPORT_LOCKED"
          : applied.code === "APPLY_BLOCKED"
            ? "APPLY_BLOCKED"
            : applied.code === "RECORD_COUNT_DECREASED"
              ? "RECORD_COUNT_DECREASED"
              : applied.code === "PRODUCT_CODE_LOSS"
                ? "PRODUCT_CODE_LOSS"
                : applied.code === "COMMIT_UNCERTAIN"
                  ? "COMMIT_UNCERTAIN"
                  : "DATABASE_ERROR";
    return sanitizeCatalogImportResult({
      status,
      mode: "apply",
      durationMs: Date.now() - startedAt,
      runId: applied.runId,
      manifestSha256: data.manifest.manifestSha256,
      totalByteSize: data.manifest.totalByteSize,
      counts: data.counts,
      message: applied.message,
      errorCode: applied.code,
      readAt: readResult.readAt,
    });
  }

  const status =
    profile === "full" && applied.quarantineCount > 0 ? "PARTIAL" : "SUCCESS";
  const classificationNote = data.classificationIncomplete
    ? " Classification is incomplete (missing group references preserved)."
    : "";
  return sanitizeCatalogImportResult({
    status,
    mode: "apply",
    profile,
    durationMs: Date.now() - startedAt,
    runId: applied.runId,
    manifestSha256: data.manifest.manifestSha256,
    totalByteSize: data.manifest.totalByteSize,
    counts: data.counts,
    coreApplied: applied.coreApplied,
    commercialReady: applied.commercialReady,
    distributionReady: applied.distributionReady,
    classificationIncomplete: data.classificationIncomplete,
    commercialStatus: data.commercialStatus,
    classificationWarningCount,
    classificationWarnings: data.classificationWarnings,
    quarantineCount: applied.quarantineCount,
    quarantine: data.quarantine,
    warningCount: data.warnings.length,
    warnings: data.warnings,
    newProducts: applied.newProducts,
    changedProducts: applied.changedProducts,
    missingFromSnapshot: applied.missingFromSnapshot,
    appliedVersionId: applied.versionId,
    message:
      status === "PARTIAL"
        ? "Catalog core applied; commercial staging stored with quarantined rows (commercialReady=false)."
        : profile === "distribution"
          ? `Distribution catalog applied successfully (distributionReady=true, commercialReady=false).${classificationNote}`
          : `Catalog import applied successfully (commercialReady=false).${classificationNote}`,
    readAt: readResult.readAt,
  });
}

export function catalogTransportWarning(): string {
  return PLAIN_FTP_TRANSPORT_WARNING;
}

export function catalogDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveCatalogDatabaseUrl(env));
}
