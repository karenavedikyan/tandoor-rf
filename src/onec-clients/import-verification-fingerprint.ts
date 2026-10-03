import { createHash } from "node:crypto";
import {
  DEFAULT_HOLDING_LINK_VALIDATION_POLICY,
  type HoldingLinkValidationPolicy,
} from "./holding-link-policy";
import type { WholesaleCompositionMode } from "./wholesale-composition";
import type { ValidatedClientsPayload } from "./types";

export type ImportVerificationInputs = {
  clientsSha256: string;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  employeeRosterSourceSha256: string | null;
  wholesaleCompositionMode: WholesaleCompositionMode;
};

const ROSTER_ABSENT = "__roster_absent__";

export function computeImportVerificationFingerprint(
  input: ImportVerificationInputs,
): string {
  const canonical = JSON.stringify({
    v: 1,
    clientsSha256: input.clientsSha256.toLowerCase(),
    holdingLinkValidationPolicy: input.holdingLinkValidationPolicy,
    employeeRosterSourceSha256: input.employeeRosterSourceSha256?.toLowerCase() ?? ROSTER_ABSENT,
    wholesaleCompositionMode: input.wholesaleCompositionMode,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function verifiedImportParametersFromPayload(payload: ValidatedClientsPayload): {
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  employeeRosterSourceSha256: string | null;
  wholesaleCompositionMode: WholesaleCompositionMode;
} {
  return {
    holdingLinkValidationPolicy:
      payload.holdingLinkValidationPolicy ?? DEFAULT_HOLDING_LINK_VALIDATION_POLICY,
    employeeRosterSourceSha256: payload.employeeRosterSourceSha256 ?? null,
    wholesaleCompositionMode: payload.wholesaleCompositionMode ?? "standard",
  };
}

export function verificationFingerprintFromPayload(input: { payload: ValidatedClientsPayload }): string {
  const verified = verifiedImportParametersFromPayload(input.payload);
  return computeImportVerificationFingerprint({
    clientsSha256: input.payload.sha256,
    holdingLinkValidationPolicy: verified.holdingLinkValidationPolicy,
    employeeRosterSourceSha256: verified.employeeRosterSourceSha256,
    wholesaleCompositionMode: verified.wholesaleCompositionMode,
  });
}

export type ApplyVerificationFailure =
  | { code: "VERIFICATION_FINGERPRINT_REQUIRED"; message: string }
  | { code: "VERIFICATION_FINGERPRINT_MISMATCH"; message: string; actualFingerprint: string }
  | { code: "VERIFICATION_PARAMETERS_MISMATCH"; message: string };

export function verifyApplyVerification(input: {
  expectedVerificationFingerprint: string | undefined;
  payload: ValidatedClientsPayload;
  holdingLinkValidationPolicy?: HoldingLinkValidationPolicy;
  employeeRosterSourceSha256?: string | null;
}): ApplyVerificationFailure | null {
  const verified = verifiedImportParametersFromPayload(input.payload);

  if (input.holdingLinkValidationPolicy !== undefined) {
    if (input.holdingLinkValidationPolicy !== verified.holdingLinkValidationPolicy) {
      return {
        code: "VERIFICATION_PARAMETERS_MISMATCH",
        message:
          "Apply holdingLinkValidationPolicy does not match the validated payload; re-run validation with the intended policy.",
      };
    }
  }

  if (input.employeeRosterSourceSha256 !== undefined) {
    const applyRoster = input.employeeRosterSourceSha256?.toLowerCase() ?? null;
    const payloadRoster = verified.employeeRosterSourceSha256?.toLowerCase() ?? null;
    if (applyRoster !== payloadRoster) {
      return {
        code: "VERIFICATION_PARAMETERS_MISMATCH",
        message:
          "Apply employeeRosterSourceSha256 does not match the validated payload; re-run validation with the intended roster.",
      };
    }
  }

  if (!input.expectedVerificationFingerprint?.trim()) {
    return {
      code: "VERIFICATION_FINGERPRINT_REQUIRED",
      message: "Apply requires expectedVerificationFingerprint from a verified dry-run.",
    };
  }

  const expected = input.expectedVerificationFingerprint.trim().toLowerCase();
  const actual = verificationFingerprintFromPayload({ payload: input.payload });
  if (expected !== actual) {
    return {
      code: "VERIFICATION_FINGERPRINT_MISMATCH",
      message:
        "Import verification fingerprint mismatch (clients file, roster, holding policy, or mode changed since verification).",
      actualFingerprint: actual,
    };
  }
  return null;
}

/** @deprecated Use verifyApplyVerification */
export function verifyApplyVerificationFingerprint(
  input: Parameters<typeof verifyApplyVerification>[0],
): ApplyVerificationFailure | null {
  return verifyApplyVerification(input);
}
