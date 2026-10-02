import {
  MAX_DETAILED_ERRORS,
  MAX_DETAILED_WARNINGS,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_RECORDS,
} from "./constants";
import {
  toLegacyValidatedPayload,
  validateExtendedClientsFileBytes,
  type ValidateClientsLimits,
} from "./extended-validate";
import type { ValidatedClientsPayload, ValidationIssue, ValidationWarning } from "./types";

export type { ValidateClientsLimits };

export type ValidationResult =
  | { ok: true; payload: ValidatedClientsPayload }
  | {
      ok: false;
      issues: ValidationIssue[];
      warnings: ValidationWarning[];
      issueCount: number;
      warningCount: number;
    };

export function validateClientsFileBytes(
  bytes: Buffer,
  limits?: ValidateClientsLimits,
): ValidationResult {
  const extended = validateExtendedClientsFileBytes(bytes, limits);
  if (!extended.ok) {
    return {
      ok: false,
      issues: extended.issues as ValidationIssue[],
      warnings: extended.warnings as ValidationWarning[],
      issueCount: extended.issueCount,
      warningCount: extended.warningCount,
    };
  }

  const payload = extended.payload;
  if (payload.sourceFormat === "legacy") {
    return {
      ok: true,
      payload: toLegacyValidatedPayload(payload),
    };
  }

  return {
    ok: true,
    payload: {
      ...toLegacyValidatedPayload(payload, { keepExtendedWarnings: true }),
      sourceFormat: payload.sourceFormat,
      extendedRecords: payload.records,
      extendedDiagnostics: payload.diagnostics,
      extendedContractVerification: payload.extendedContractVerification ?? limits?.extendedContractVerification ?? "unverified",
    },
  };
}

