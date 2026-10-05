import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveManagerRosterStateForApply } from "../../src/onec-clients/manager-status";
import { verifyApplyVerification } from "../../src/onec-clients/import-verification-fingerprint";
import type { ValidatedClientsPayload } from "../../src/onec-clients/types";

describe("resolveManagerRosterStateForApply", () => {
  it("preserves outside restriction when roster is absent and manager unchanged", () => {
    assert.equal(
      resolveManagerRosterStateForApply({
        incomingState: "roster_not_loaded",
        incomingManagerGuid: "99999999-9999-4999-8999-999999999999",
        previousManagerRosterState: "outside_wholesale_roster",
        previousManagerGuid: "99999999-9999-4999-8999-999999999999",
        rosterLoadedInPayload: false,
      }),
      "outside_wholesale_roster",
    );
  });

  it("blocks unconfirmed manager change without roster when client was already outside", () => {
    assert.equal(
      resolveManagerRosterStateForApply({
        incomingState: "roster_not_loaded",
        incomingManagerGuid: "22222222-2222-4222-8222-222222222222",
        previousManagerRosterState: "outside_wholesale_roster",
        previousManagerGuid: "99999999-9999-4999-8999-999999999999",
        rosterLoadedInPayload: false,
      }),
      "outside_wholesale_roster",
    );
  });

  it("blocks manager reassignment without roster even when client was in active scope", () => {
    assert.equal(
      resolveManagerRosterStateForApply({
        incomingState: "roster_not_loaded",
        incomingManagerGuid: "55555555-5555-4555-8555-555555555555",
        previousManagerRosterState: "in_wholesale_roster",
        previousManagerGuid: "22222222-2222-4222-8222-222222222222",
        rosterLoadedInPayload: false,
      }),
      "outside_wholesale_roster",
    );
  });

  it("accepts roster-confirmed inclusion", () => {
    assert.equal(
      resolveManagerRosterStateForApply({
        incomingState: "in_wholesale_roster",
        incomingManagerGuid: "22222222-2222-4222-8222-222222222222",
        previousManagerRosterState: "outside_wholesale_roster",
        previousManagerGuid: "99999999-9999-4999-8999-999999999999",
        rosterLoadedInPayload: true,
      }),
      "in_wholesale_roster",
    );
  });
});

describe("verifyApplyVerification", () => {
  const payload: ValidatedClientsPayload = {
    sha256: "a".repeat(64),
    byteSize: 1,
    recordCount: 1,
    records: [],
    warnings: [],
    warningCount: 0,
    holdingLinkValidationPolicy: "tolerant",
    employeeRosterSourceSha256: null,
    wholesaleCompositionMode: "standard",
  };

  it("rejects policy override before fingerprint check", () => {
    const failure = verifyApplyVerification({
      payload,
      expectedVerificationFingerprint: "b".repeat(64),
      holdingLinkValidationPolicy: "strict",
    });
    assert.equal(failure?.code, "VERIFICATION_PARAMETERS_MISMATCH");
  });
});
