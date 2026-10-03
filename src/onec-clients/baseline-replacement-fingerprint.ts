import { createHash } from "node:crypto";
import type { HoldingLinkValidationPolicy } from "./holding-link-policy";

export type BaselineReplacementFingerprintInput = {
  clientsSha256: string;
  rosterSha256: string | null;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
  quarantineManifestSha256: string | null;
  acceptedCompositionSha256: string;
  dbBaselineSha256: string;
  extendedContractConfirmationSha256: string | null;
};

const ROSTER_ABSENT = "__roster_absent__";

export function computeAcceptedCompositionSha256(acceptedGuids: Iterable<string>): string {
  const sorted = [...acceptedGuids].map((guid) => guid.toLowerCase()).sort();
  return createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}

/** @deprecated Use computeDbBaselineStateSha256 from baseline-replacement-db-state */
export function computeDbBaselineSha256(activeGuids: Iterable<string>): string {
  const sorted = [...activeGuids].map((guid) => guid.toLowerCase()).sort();
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, count: sorted.length, guids: sorted }), "utf8")
    .digest("hex");
}

export { computeDbBaselineStateSha256 } from "./baseline-replacement-db-state";

export function computeBaselineReplacementFingerprint(input: BaselineReplacementFingerprintInput): string {
  const canonical = JSON.stringify({
    v: 3,
    kind: "wholesale_baseline_replacement",
    clientsSha256: input.clientsSha256.toLowerCase(),
    rosterSha256: input.rosterSha256?.toLowerCase() ?? ROSTER_ABSENT,
    holdingLinkValidationPolicy: input.holdingLinkValidationPolicy,
    quarantineManifestSha256: input.quarantineManifestSha256?.toLowerCase() ?? null,
    acceptedCompositionSha256: input.acceptedCompositionSha256.toLowerCase(),
    dbBaselineStateSha256: input.dbBaselineSha256.toLowerCase(),
    extendedContractConfirmationSha256: input.extendedContractConfirmationSha256?.toLowerCase() ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
