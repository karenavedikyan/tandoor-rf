import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  CLIENTS_FIXTURE_NAMES,
  loadClientsFixture,
} from "../helpers/onec-clients-fixture-files";

describe("onec clients synthetic fixtures (R0.2)", () => {
  it("valid-two-records.json passes validation", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.validTwoRecords),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.recordCount, 2);
      assert.equal(result.payload.warningCount, 0);
    }
  });

  it("empty-address-and-phones.json passes with EMPTY_* warnings", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.emptyAddressPhones),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.warningCount, 2);
      assert.ok(result.payload.warnings.some((w) => w.code === "EMPTY_ADDRESS"));
      assert.ok(result.payload.warnings.some((w) => w.code === "EMPTY_TELEPHONE"));
    }
  });

  it("duplicate-guid.json fails with DUPLICATE_CLIENT", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.duplicateGuid),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_CLIENT"));
    }
  });

  it("invalid-guid.json fails with INVALID_UUID", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.invalidGuid),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "INVALID_UUID"));
    }
  });

  it("invalid-telephone-type.json fails with INVALID_TYPE on telephone", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.invalidTelephoneType),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.issues.some(
          (issue) => issue.code === "INVALID_TYPE" && issue.field === "telephone",
        ),
      );
    }
  });

  it("extra-unknown-fields.json passes with EXTRA_FIELDS only (commercial keys not imported)", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.extraUnknownFields),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.warningCount, 1);
      assert.ok(result.payload.warnings.some((w) => w.code === "EXTRA_FIELDS"));
    }
  });

  it("holding-id-without-name.json fails with HOLDING_CONTRACT", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.holdingContractViolation),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "HOLDING_CONTRACT"));
    }
  });

  it("invalid-json.json and truncated-json.json fail with INVALID_JSON", () => {
    for (const name of [CLIENTS_FIXTURE_NAMES.invalidJson, CLIENTS_FIXTURE_NAMES.truncatedJson]) {
      const result = validateClientsFileBytes(loadClientsFixture(name));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.issues.some((issue) => issue.code === "INVALID_JSON"));
      }
    }
  });

  it("repeat-snapshot.json matches subset of valid-two-records first record", () => {
    const repeat = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.repeatSnapshot),
    );
    assert.equal(repeat.ok, true);
    if (repeat.ok) {
      assert.equal(repeat.payload.records[0]?.guid_client, "11111111-1111-4111-8111-111111111111");
    }
  });
});
