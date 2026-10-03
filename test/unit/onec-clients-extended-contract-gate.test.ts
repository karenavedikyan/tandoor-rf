import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExtendedContractVerified } from "../../src/onec-clients/extended-apply";
import {
  buildExtendedContractConfirmation,
  extendedContractConfirmationSha256,
  resolveExtendedContractVerificationForBaseline,
} from "../../src/onec-clients/extended-contract-gate";
import type { ValidatedClientsPayload } from "../../src/onec-clients/types";

function samplePayload(sha256: string): ValidatedClientsPayload {
  return {
    sha256,
    byteSize: 100,
    recordCount: 1,
    records: [],
    warnings: [],
    warningCount: 0,
    sourceFormat: "extended_v1",
    extendedRecords: [],
    holdingLinkValidationPolicy: "tolerant",
    wholesaleCompositionMode: "standard",
  };
}

describe("extended contract gate", () => {
  it("never treats unverified payload as production-verified", () => {
    const payload = samplePayload("aa".repeat(32));
    payload.extendedContractVerification = "unverified";
    assert.equal(isExtendedContractVerified(payload), false);
  });

  it("accepts operator_confirmed for controlled baseline apply", () => {
    const payload = samplePayload("aa".repeat(32));
    payload.extendedContractVerification = "operator_confirmed";
    assert.equal(isExtendedContractVerified(payload), true);
  });

  it("requires stored confirmation sha to match for operator_confirmed resolution", () => {
    const payload = samplePayload("bb".repeat(32));
    const confirmation = buildExtendedContractConfirmation({
      payload,
      operatorReference: "audit-42",
    });
    const sha = extendedContractConfirmationSha256(confirmation);
    assert.equal(
      resolveExtendedContractVerificationForBaseline({
        payload,
        confirmation,
        storedConfirmationSha256: sha,
      }),
      "operator_confirmed",
    );
    assert.equal(
      resolveExtendedContractVerificationForBaseline({
        payload,
        confirmation,
        storedConfirmationSha256: "cc".repeat(32),
      }),
      "unverified",
    );
  });
});
