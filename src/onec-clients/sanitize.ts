import { redactSecrets } from "../onec-ftp/sanitize";
import type { ClientsImportResult, ValidationIssue, ValidationWarning } from "./types";

export const MAX_IMPORT_REPORT_BYTES = 65_536;
export const PLAIN_FTP_TRANSPORT_WARNING =
  "Login, password, and file data are transmitted without encryption.";

export function formatImportReportForCli(result: ClientsImportResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function importReportByteLength(result: ClientsImportResult): number {
  return Buffer.byteLength(formatImportReportForCli(result), "utf8");
}

function sanitizeIssues(issues: ValidationIssue[] | undefined, secrets: string[]): ValidationIssue[] | undefined {
  if (!issues) {
    return undefined;
  }
  return issues.map((issue) => ({
    ...issue,
    field: issue.field ? redactSecrets(issue.field, secrets) : issue.field,
  }));
}

function sanitizeWarnings(
  warnings: ValidationWarning[] | undefined,
  secrets: string[],
): ValidationWarning[] | undefined {
  if (!warnings) {
    return undefined;
  }
  return warnings.map((warning) => ({
    ...warning,
    field: warning.field ? redactSecrets(warning.field, secrets) : warning.field,
  }));
}

function limitReportSize(result: ClientsImportResult): ClientsImportResult {
  if (importReportByteLength(result) <= MAX_IMPORT_REPORT_BYTES) {
    return result;
  }

  const compact: ClientsImportResult = {
    ...result,
    errors: result.errors?.slice(0, 10),
    warnings: result.warnings?.slice(0, 5),
    errorsTruncated: true,
    warningsTruncated: true,
    message: redactSecrets(
      "Import report exceeded the allowed size limit; detailed issues were truncated.",
    ),
  };

  if (importReportByteLength(compact) <= MAX_IMPORT_REPORT_BYTES) {
    return compact;
  }

  return {
    status: result.status,
    mode: result.mode,
    durationMs: result.durationMs,
    security: "plain",
    transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
    sha256: result.sha256,
    byteSize: result.byteSize,
    recordCount: result.recordCount,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    errorsTruncated: true,
    warningsTruncated: true,
    message: "Import report exceeded the allowed size limit.",
    errorCode: result.errorCode,
  };
}

export function sanitizeImportResult(
  result: ClientsImportResult,
  secrets: string[] = [],
): ClientsImportResult {
  const clone: ClientsImportResult = {
    ...result,
    message: redactSecrets(result.message, secrets),
    errors: sanitizeIssues(result.errors, secrets),
    warnings: sanitizeWarnings(result.warnings, secrets),
    transportWarning: PLAIN_FTP_TRANSPORT_WARNING,
  };
  return limitReportSize(clone);
}
