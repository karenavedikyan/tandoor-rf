import { getDatabaseUrl } from "../config";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { applyClientsImport, createImportPool, type ImportTriggerSource } from "./apply";
import {
  CLI_ARGUMENT_ERROR_MESSAGES,
  parseClientsImportCliArgs,
  readEmployeeRosterFileBytes,
} from "./cli-args";
import { MAX_DETAILED_ERRORS, MAX_DETAILED_WARNINGS } from "./constants";
import { parseWholesaleEmployeeRosterBytes, type WholesaleEmployeeRoster } from "./employee-roster";
import { verificationFingerprintFromPayload } from "./import-verification-fingerprint";
import { type FtpReader, readClientsFileFromFtp } from "./ftp-read";
import { PLAIN_FTP_TRANSPORT_WARNING, sanitizeImportResult } from "./sanitize";
import type { ValidateClientsLimits } from "./validate";
import type { ClientsImportCliOptions, ClientsImportResult, ValidationIssue } from "./types";
import { validateClientsFileBytes } from "./validate";
import {
  buildWholesaleCompositionPrepReport,
  rejectWholesaleCompositionPrepApply,
} from "./wholesale-composition";
import {
  loadExistingCompositionContext,
  unavailableCompositionContext,
} from "./wholesale-composition-db";

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
  extendedDiagnostics?: ClientsImportResult["extendedDiagnostics"];
  holdingLinkValidationPolicy?: ClientsImportResult["holdingLinkValidationPolicy"];
  issueCodes?: string[];
  warningCodes?: string[];
  issuesTruncated?: boolean;
  warningsTruncated?: boolean;
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
    errorsTruncated: input.issuesTruncated ?? input.totalIssueCount > MAX_DETAILED_ERRORS,
    warningsTruncated: input.warningsTruncated ?? input.totalWarningCount > MAX_DETAILED_WARNINGS,
    issueCodes: input.issueCodes,
    warningCodes: input.warningCodes,
    extendedDiagnostics: input.extendedDiagnostics,
    holdingLinkValidationPolicy: input.holdingLinkValidationPolicy,
    message: "Client file validation failed.",
  };
}

export type RunClientsImportOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  ftpReader?: FtpReader;
  fileBytes?: Buffer;
  employeeRosterBytes?: Buffer;
  validationLimits?: ValidateClientsLimits;
  triggerSource?: ImportTriggerSource;
};

function buildValidationLimits(
  cliOptions: ClientsImportCliOptions,
  employeeRoster: WholesaleEmployeeRoster | null | undefined,
  overrides: ValidateClientsLimits | undefined,
  employeeRosterExplicit: boolean,
): ValidateClientsLimits {
  return {
    ...overrides,
    holdingLinkValidationPolicy:
      overrides?.holdingLinkValidationPolicy ?? cliOptions.holdingLinkValidationPolicy,
    employeeRoster: overrides?.employeeRoster ?? employeeRoster ?? null,
    employeeRosterExplicit: overrides?.employeeRosterExplicit ?? employeeRosterExplicit,
    wholesaleCompositionMode: cliOptions.wholesaleCompositionPrep
      ? "replacement_prep"
      : overrides?.wholesaleCompositionMode ?? "standard",
  };
}

async function buildCompositionPrepReportIfRequested(
  cliOptions: ClientsImportCliOptions,
  payload: import("./types").ValidatedClientsPayload,
  databaseUrl: string | undefined,
): Promise<ClientsImportResult["wholesaleCompositionPrep"]> {
  if (!cliOptions.wholesaleCompositionPrep) {
    return undefined;
  }
  if (!databaseUrl) {
    return buildWholesaleCompositionPrepReport({
      payload,
      holdingLinkPolicy: payload.holdingLinkValidationPolicy ?? cliOptions.holdingLinkValidationPolicy ?? "tolerant",
      employeeRosterLoaded: payload.extendedDiagnostics?.employeeDirectoryVerified === true,
      employeeRosterSourceSha256: payload.employeeRosterSourceSha256 ?? null,
      wholesaleEmployeeCount: payload.extendedDiagnostics?.wholesaleEmployeeCount ?? null,
      existing: unavailableCompositionContext(),
    });
  }

  const pool = createImportPool(databaseUrl);
  try {
    const client = await pool.connect();
    try {
      const existing = await loadExistingCompositionContext(client);
      return buildWholesaleCompositionPrepReport({
        payload,
        holdingLinkPolicy:
          payload.holdingLinkValidationPolicy ?? cliOptions.holdingLinkValidationPolicy ?? "tolerant",
        employeeRosterLoaded: payload.extendedDiagnostics?.employeeDirectoryVerified === true,
        employeeRosterSourceSha256: payload.employeeRosterSourceSha256 ?? null,
        wholesaleEmployeeCount: payload.extendedDiagnostics?.wholesaleEmployeeCount ?? null,
        existing,
      });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

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

  let employeeRosterBytes = options.employeeRosterBytes;
  if (cliOptions.employeeRosterFile) {
    const rosterFromFile = readEmployeeRosterFileBytes(cliOptions.employeeRosterFile);
    if (!rosterFromFile.ok) {
      return sanitizeImportResult(
        {
          status: "ARGUMENT_ERROR",
          mode: cliOptions.mode,
          durationMs: Date.now() - startedAt,
          security: "plain",
          transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
          message: CLI_ARGUMENT_ERROR_MESSAGES[rosterFromFile.code],
          errorCode: rosterFromFile.code,
        },
        [],
      );
    }
    employeeRosterBytes = rosterFromFile.bytes;
  }

  let parsedEmployeeRoster: WholesaleEmployeeRoster | undefined;
  if (employeeRosterBytes != null) {
    const rosterParse = parseWholesaleEmployeeRosterBytes(employeeRosterBytes);
    if (!rosterParse.ok) {
      return sanitizeImportResult(
        {
          status: "ARGUMENT_ERROR",
          mode: cliOptions.mode,
          durationMs: Date.now() - startedAt,
          security: "plain",
          transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
          message: rosterParse.message,
          errorCode: "EMPLOYEE_ROSTER_INVALID",
        },
        [],
      );
    }
    parsedEmployeeRoster = rosterParse.roster;
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

  const validationLimits = buildValidationLimits(
    cliOptions,
    parsedEmployeeRoster,
    options.validationLimits,
    employeeRosterBytes != null || cliOptions.employeeRosterFile != null,
  );
  const validated = validateClientsFileBytes(bytes, validationLimits);
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
        extendedDiagnostics: validated.extendedDiagnostics ?? undefined,
        holdingLinkValidationPolicy: validationLimits.holdingLinkValidationPolicy,
        issueCodes: validated.issueCodes,
        warningCodes: validated.warningCodes,
        issuesTruncated: validated.issuesTruncated,
        warningsTruncated: validated.warningsTruncated,
      }),
      secrets,
    );
  }

  const payload = validated.payload;
  const verificationFingerprint = verificationFingerprintFromPayload({ payload });
  const databaseUrl =
    env.DATABASE_URL !== undefined
      ? env.DATABASE_URL.trim() || undefined
      : getDatabaseUrl() || undefined;
  const wholesaleCompositionPrep = await buildCompositionPrepReportIfRequested(
    cliOptions,
    payload,
    databaseUrl,
  );

  if (cliOptions.mode === "dry_run") {
    const prepSuffix = cliOptions.wholesaleCompositionPrep
      ? " Wholesale composition prep report attached; no database writes."
      : "";
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
        extendedDiagnostics: payload.extendedDiagnostics,
        holdingLinkValidationPolicy: payload.holdingLinkValidationPolicy,
        verificationFingerprint,
        wholesaleCompositionPrep,
        message: `Client file validation succeeded (dry run; no database changes).${prepSuffix}`,
      },
      secrets,
    );
  }

  const prepApplyRejection = rejectWholesaleCompositionPrepApply({
    wholesaleCompositionPrep: cliOptions.wholesaleCompositionPrep,
    payload,
  });
  if (prepApplyRejection) {
    return sanitizeImportResult(
      {
        status: "APPLY_BLOCKED",
        mode: "apply",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        message: prepApplyRejection.message,
        errorCode: prepApplyRejection.code,
        holdingLinkValidationPolicy: payload.holdingLinkValidationPolicy,
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

  const applied = await applyClientsImport({
    databaseUrl,
    payload,
    triggerSource: options.triggerSource ?? "manual",
    expectedVerificationFingerprint: cliOptions.expectedSha256,
  });
  if (!applied.ok) {
    const mappedErrorCode =
      applied.code === "VERIFICATION_FINGERPRINT_MISMATCH"
        ? "HASH_MISMATCH"
        : applied.code === "VERIFICATION_FINGERPRINT_REQUIRED" ||
            applied.code === "VERIFICATION_PARAMETERS_MISMATCH"
          ? "ARGUMENT_ERROR"
          : applied.code;
    return sanitizeImportResult(
      {
        status: mappedErrorCode,
        mode: "apply",
        durationMs: Date.now() - startedAt,
        security: "plain",
        transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        message: applied.message,
        errorCode: mappedErrorCode,
        apply: applied.runId ? { runId: applied.runId } : undefined,
      },
      secrets,
    );
  }

  const extendedBlockedCount = applied.counts.extendedBlockedCount ?? 0;
  const extendedAppliedCount = applied.blockSummary?.extendedAppliedCount ?? 0;
  const outletParentLinkConflicts = applied.blockSummary?.outletParentLinkConflicts ?? 0;
  const extendedApplied = applied.blockSummary?.extendedApplied;
  const extendedBlockReason = applied.blockSummary?.extendedBlockReason ?? null;
  let applyMessage = "Client import applied successfully.";
  if (extendedApplied === false && extendedBlockedCount > 0) {
    if (extendedBlockReason === "outlet_parent_link_conflict") {
      applyMessage =
        outletParentLinkConflicts === 1
          ? "Legacy client fields applied; extended block blocked for 1 client due to outlet parent-card conflict with registry."
          : `Legacy client fields applied; extended block blocked for ${extendedBlockedCount} client(s) due to ${outletParentLinkConflicts} outlet parent-card conflict(s) with registry.`;
    } else if (extendedBlockReason === "awaiting_live_json_verification") {
      applyMessage =
        "Legacy client fields applied; extended block was not published (awaiting live JSON contract verification).";
    } else if (extendedBlockReason === "extended_partially_blocked") {
      applyMessage =
        extendedAppliedCount > 0
          ? `Client import applied with legacy fields; ${extendedAppliedCount} extended record(s) published and ${extendedBlockedCount} blocked.`
          : "Client import applied with legacy fields; extended block was partially blocked.";
    } else {
      applyMessage =
        "Legacy client fields applied; extended block was not fully published.";
    }
  } else if (extendedApplied === true && extendedBlockedCount > 0) {
    applyMessage =
      "Client import applied with legacy fields; some extended records were skipped.";
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
      extendedDiagnostics: payload.extendedDiagnostics,
      holdingLinkValidationPolicy: payload.holdingLinkValidationPolicy,
      wholesaleCompositionPrep,
      message: applyMessage,
      cleanupWarning: applied.cleanupWarning,
      apply: {
        runId: applied.runId,
        newCount: applied.counts.newCount,
        changedCount: applied.counts.changedCount,
        unchangedCount: applied.counts.unchangedCount,
        extendedBlockedCount: extendedBlockedCount > 0 ? extendedBlockedCount : undefined,
        extendedAppliedCount: extendedAppliedCount > 0 ? extendedAppliedCount : undefined,
        extendedApplied: extendedApplied === undefined ? undefined : extendedApplied,
        extendedBlockReason: extendedBlockReason ?? undefined,
        outletParentLinkConflicts:
          outletParentLinkConflicts > 0 ? outletParentLinkConflicts : undefined,
      },
    },
    secrets,
  );
}
