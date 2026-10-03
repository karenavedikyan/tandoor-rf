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
