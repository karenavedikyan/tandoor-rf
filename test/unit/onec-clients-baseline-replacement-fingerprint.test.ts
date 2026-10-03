import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeAcceptedCompositionSha256,
  computeBaselineReplacementFingerprint,
  computeDbBaselineSha256,
} from "../../src/onec-clients/baseline-replacement-fingerprint";

describe("baseline replacement fingerprint", () => {
  it("changes when accepted composition or db baseline changes", () => {
    const base = {
      clientsSha256: "aa".repeat(32),
      rosterSha256: "bb".repeat(32),
      holdingLinkValidationPolicy: "tolerant" as const,
      quarantineManifestSha256: "cc".repeat(32),
      acceptedCompositionSha256: computeAcceptedCompositionSha256(["11111111-1111-4111-8111-111111111111"]),
      dbBaselineSha256: computeDbBaselineSha256(["22222222-2222-4222-8222-222222222222"]),
      extendedContractConfirmationSha256: null,
    };
    const first = computeBaselineReplacementFingerprint(base);
    const second = computeBaselineReplacementFingerprint({
      ...base,
      acceptedCompositionSha256: computeAcceptedCompositionSha256([
        "11111111-1111-4111-8111-111111111111",
        "33333333-3333-4333-8333-333333333333",
      ]),
    });
    assert.notEqual(first, second);
  });
});
