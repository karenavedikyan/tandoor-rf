import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWN_CLIENT_KEYS } from "../../src/onec-clients/constants";
import type { ParsedClientRecord } from "../../src/onec-clients/types";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  CLIENTS_FIXTURE_NAMES,
  loadClientsFixture,
} from "../helpers/onec-clients-fixture-files";

const PARSED_RECORD_KEYS = KNOWN_CLIENT_KEYS satisfies readonly (keyof ParsedClientRecord)[];

function assertParsedRecordShape(record: ParsedClientRecord): void {
  assert.deepEqual(Object.keys(record).sort(), [...PARSED_RECORD_KEYS].sort());
}

describe("onec clients synthetic fixtures (R0.2)", () => {
  it("valid-two-records.json passes validation", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.validTwoRecords),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.recordCount, 2);
      assert.equal(result.payload.warningCount, 0);
      result.payload.records.forEach(assertParsedRecordShape);
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

  it("extra-unknown-fields.json warns and drops extra keys from normalized record", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.extraUnknownFields),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.warningCount, 1);
      assert.ok(result.payload.warnings.some((w) => w.code === "EXTRA_FIELDS"));
      assert.equal(result.payload.records.length, 1);
      const record = result.payload.records[0]!;
      assertParsedRecordShape(record);
      assert.equal("Discount" in record, false);
      assert.equal("DiscountAmount" in record, false);
      assert.equal("Markups" in record, false);
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

  it("repeat-snapshot.json normalizes to same record as first entry in valid-two-records.json (validation only)", () => {
    const baseline = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.validTwoRecords),
    );
    const repeat = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.repeatSnapshot),
    );
    assert.equal(baseline.ok, true);
    assert.equal(repeat.ok, true);
    if (baseline.ok && repeat.ok) {
      assert.deepEqual(repeat.payload.records[0], baseline.payload.records[0]);
    }
  });

  it("valid-uuid-v5.json accepts non-zero UUID version 5 (validator contract)", () => {
    const result = validateClientsFileBytes(
      loadClientsFixture(CLIENTS_FIXTURE_NAMES.validUuidV5),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.records[0]?.guid_client, "886313e1-3b8a-5372-9b63-92f9c79bd42a");
      assert.equal(result.payload.records[0]?.guid_manager, "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    }
  });
});
