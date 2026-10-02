import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateExtendedClientsFileBytes } from "../../src/onec-clients/extended-validate";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildExtendedClientsFileBytes,
  legacyOnlyFileBytes,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";

describe("onec clients extended validate", () => {
  it("accepts legacy-only file through unified validator", () => {
    const result = validateClientsFileBytes(legacyOnlyFileBytes());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.sourceFormat, "legacy");
      assert.equal(result.payload.recordCount, 2);
    }
  });

  it("detects extended format with holding boolean and nested outlets", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding(),
      sampleExtendedChild(),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.sourceFormat, "extended_v1");
      assert.equal(result.payload.diagnostics.holdingCardCount, 1);
      assert.equal(result.payload.diagnostics.nestedOutletCount, 2);
      assert.equal(result.payload.diagnostics.outletsWithoutGuid, 2);
      assert.equal(result.payload.diagnostics.blocks.outletNormalizedReady, false);
    }
  });

  it("allows guid_holding without name_holding in extended format", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding(),
      sampleExtendedChild(),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.records[1]?.name_holding, "");
      assert.equal(result.payload.records[1]?.guid_holding, result.payload.records[0]?.guid_client);
    }
  });

  it("rejects Boolean string for holding flag", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ holding: "false" }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "INVALID_HOLDING_BOOLEAN"));
    }
  });

  it("rejects unknown holding guid references", () => {
    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedChild({ guid_holding: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "HOLDING_GUID_UNKNOWN"));
    }
  });

  it("keeps legacy holding contract for legacy-only files", () => {
    const bytes = buildClientsFileBytes([
      sampleClient({
        guid_holding: "44444444-4444-4444-8444-444444444444",
        name_holding: "",
      }),
    ]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "HOLDING_CONTRACT"));
    }
  });

  it("parses explicit empty outlet manager as unassigned", () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      const outlet = result.payload.records[0]?.retailOutlets[0];
      assert.equal(outlet?.managers.manager.state, "unassigned");
      assert.equal(outlet?.managers.manager.guid, null);
    }
  });

  it("does not treat outlet presence as normalized business id", () => {
    const bytes = buildExtendedClientsFileBytes([sampleExtendedHolding()]);
    const result = validateExtendedClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      const outlet = result.payload.records[0]?.retailOutlets[0];
      assert.equal(outlet?.outletGuidStatus, "not_provided");
      assert.equal(outlet?.distributionAllowed, false);
    }
  });
});
