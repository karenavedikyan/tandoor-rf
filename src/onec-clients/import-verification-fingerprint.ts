import { createHash } from "node:crypto";
import type { HoldingLinkValidationPolicy } from "./holding-link-policy";
import type { WholesaleCompositionMode } from "./wholesale-composition";

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

export function verificationFingerprintFromPayload(input: {
  payload: import("./types").ValidatedClientsPayload;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  employeeRosterSourceSha256: string | null;
}): string {
  return computeImportVerificationFingerprint({
    clientsSha256: input.payload.sha256,
    holdingLinkValidationPolicy: input.holdingLinkValidationPolicy,
    employeeRosterSourceSha256: input.employeeRosterSourceSha256,
    wholesaleCompositionMode: input.payload.wholesaleCompositionMode ?? "standard",
  });
}

export type ApplyVerificationFingerprintFailure =
  | { code: "VERIFICATION_FINGERPRINT_REQUIRED"; message: string }
  | { code: "VERIFICATION_FINGERPRINT_MISMATCH"; message: string; actualFingerprint: string };

export function verifyApplyVerificationFingerprint(input: {
  expectedVerificationFingerprint: string | undefined;
  payload: import("./types").ValidatedClientsPayload;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  employeeRosterSourceSha256: string | null;
}): ApplyVerificationFingerprintFailure | null {
  if (!input.expectedVerificationFingerprint?.trim()) {
    return {
      code: "VERIFICATION_FINGERPRINT_REQUIRED",
      message: "Apply requires expectedVerificationFingerprint from a verified dry-run.",
    };
  }
  const expected = input.expectedVerificationFingerprint.trim().toLowerCase();
  const actual = verificationFingerprintFromPayload({
    payload: input.payload,
    holdingLinkValidationPolicy: input.holdingLinkValidationPolicy,
    employeeRosterSourceSha256: input.employeeRosterSourceSha256,
  });
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
