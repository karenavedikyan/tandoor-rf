import { getDatabaseUrl } from "../config";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { applyClientsImport } from "./apply";
import { CLI_ARGUMENT_ERROR_MESSAGES, parseClientsImportCliArgs } from "./cli-args";
import { MAX_DETAILED_ERRORS, MAX_DETAILED_WARNINGS } from "./constants";
import { type FtpReader, readClientsFileFromFtp } from "./ftp-read";
import { PLAIN_FTP_TRANSPORT_WARNING, sanitizeImportResult } from "./sanitize";
import type { ClientsImportCliOptions, ClientsImportResult, ValidationIssue } from "./types";
import { validateClientsFileBytes } from "./validate";

export function getImportExitCode(status: ClientsImportResult["status"]): number {
  return status === "SUCCESS" ? 0 : 1;
}

function validationFailedResult(input: {
  mode: ClientsImportCliOptions["mode"];
  startedAt: number;
  issues: ValidationIssue[];
  warnings: ClientsImportResult["warnings"];
  totalIssueCount: number;
  totalWarningCount: number;
  sha256?: string;
  byteSize?: number;
}): ClientsImportResult {
  return {
    status: "VALIDATION_FAILED",
    mode: input.mode,
    durationMs: Date.now() - input.startedAt,
    security: "plain",
    transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
    sha256: input.sha256,
    byteSize: input.byteSize,
    recordCount: undefined,
    errorCount: input.totalIssueCount,
    warningCount: input.totalWarningCount,
    errors: input.issues.slice(0, MAX_DETAILED_ERRORS),
    warnings: input.warnings?.slice(0, MAX_DETAILED_WARNINGS),
    errorsTruncated: input.totalIssueCount > MAX_DETAILED_ERRORS,
    warningsTruncated: input.totalWarningCount > MAX_DETAILED_WARNINGS,
    message: "Client file validation failed.",
  };
}

export type RunClientsImportOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  ftpReader?: FtpReader;
  fileBytes?: Buffer;
};

export async function runClientsImport(
  options: RunClientsImportOptions = {},
): Promise<ClientsImportResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const argv = options.argv ?? [];

  const parsedArgs = parseClientsImportCliArgs(argv);
  if (!parsedArgs.ok) {
    return sanitizeImportResult(
      {
        status: "ARGUMENT_ERROR",
        mode: "dry_run",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        message: CLI_ARGUMENT_ERROR_MESSAGES[parsedArgs.code],
        errorCode: parsedArgs.code,
      },
      [],
    );
  }

  const cliOptions = parsedArgs.options;
  const loadedConfig = loadOnecFtpConfig(env);
  if (!loadedConfig.ok) {
    return sanitizeImportResult(
      {
        status: "CONFIG_ERROR",
        mode: cliOptions.mode,
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        message: loadedConfig.message,
        errorCode: "CONFIG_ERROR",
      },
      [],
    );
  }

  const secrets = [loadedConfig.config.password];
  let bytes: Buffer;
  if (options.fileBytes) {
    bytes = options.fileBytes;
  } else {
    const ftpRead = await readClientsFileFromFtp(
      loadedConfig.config,
      options.ftpReader,
    );
    if (!ftpRead.ok) {
      return sanitizeImportResult(
        {
          status: ftpRead.code === "TIMEOUT" ? "TIMEOUT" : "FTP_ERROR",
          mode: cliOptions.mode,
          durationMs: Date.now() - startedAt,
          security: "plain",
          transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
          message: ftpRead.message,
          errorCode: ftpRead.code,
        },
        secrets,
      );
    }
    bytes = ftpRead.bytes;
  }

  const validated = validateClientsFileBytes(bytes);
  if (!validated.ok) {
    return sanitizeImportResult(
      validationFailedResult({
        mode: cliOptions.mode,
        startedAt,
        issues: validated.issues,
        warnings: validated.warnings,
        totalIssueCount: validated.issueCount,
        totalWarningCount: validated.warningCount,
        byteSize: bytes.length,
      }),
      secrets,
    );
  }

  const payload = validated.payload;

  if (cliOptions.mode === "dry_run") {
    return sanitizeImportResult(
      {
        status: "SUCCESS",
        mode: "dry_run",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        warningCount: payload.warningCount,
        warnings: payload.warnings.slice(0, MAX_DETAILED_WARNINGS),
        warningsTruncated: payload.warningCount > MAX_DETAILED_WARNINGS,
        message: "Client file validation succeeded (dry run; no database changes).",
      },
      secrets,
    );
  }

  if (!cliOptions.expectedSha256) {
    return sanitizeImportResult(
      {
        status: "ARGUMENT_ERROR",
        mode: "apply",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        message: CLI_ARGUMENT_ERROR_MESSAGES.APPLY_REQUIRES_EXPECTED_SHA256,
        errorCode: "APPLY_REQUIRES_EXPECTED_SHA256",
      },
      secrets,
    );
  }

  if (payload.sha256 !== cliOptions.expectedSha256) {
    return sanitizeImportResult(
      {
        status: "HASH_MISMATCH",
        mode: "apply",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        message: "Source file SHA-256 does not match --expected-sha256.",
        errorCode: "HASH_MISMATCH",
      },
      secrets,
    );
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return sanitizeImportResult(
      {
        status: "DATABASE_ERROR",
        mode: "apply",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        message: "DATABASE_URL is required for apply mode.",
        errorCode: "DATABASE_ERROR",
      },
      secrets,
    );
  }

  const applied = await applyClientsImport({ databaseUrl, payload });
  if (!applied.ok) {
    return sanitizeImportResult(
      {
        status: applied.code,
        mode: "apply",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        message: applied.message,
        errorCode: applied.code,
        apply: applied.runId ? { runId: applied.runId } : undefined,
      },
      secrets,
    );
  }

  return sanitizeImportResult(
    {
      status: "SUCCESS",
      mode: "apply",
      durationMs: Date.now() - startedAt,
      security: "plain",
      transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
      sha256: payload.sha256,
      byteSize: payload.byteSize,
      recordCount: payload.recordCount,
      warningCount: payload.warningCount,
      warnings: payload.warnings.slice(0, MAX_DETAILED_WARNINGS),
      warningsTruncated: payload.warningCount > MAX_DETAILED_WARNINGS,
      message: "Client import applied successfully.",
      cleanupWarning: applied.cleanupWarning,
      apply: {
        runId: applied.runId,
        newCount: applied.counts.newCount,
        changedCount: applied.counts.changedCount,
        unchangedCount: applied.counts.unchangedCount,
      },
    },
    secrets,
  );
}
