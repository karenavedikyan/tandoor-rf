import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBundleParityOk } from "../../src/onec-sales/bundle-analyze";

describe("bundle parity guard", () => {
  it("rejects metric mismatches", () => {
    const ok = isBundleParityOk({
      salesAggregate: { sha256: "a", rows: 0, duplicateKeys: { rawRowCount: 0, distinctGroupCount: 0, extraRows: 0 } },
      salesItems: { sha256: "b", rows: 0, duplicateKeys: { rawRowCount: 0, distinctGroupCount: 0, extraRows: 0 } },
      returnsAggregate: { sha256: "c", rows: 0, duplicateKeys: { rawRowCount: 0, distinctGroupCount: 0, extraRows: 0 } },
      returnsItems: { sha256: "d", rows: 0, duplicateKeys: { rawRowCount: 0, distinctGroupCount: 0, extraRows: 0 } },
      distinctClientGuids: { salesAggregate: 0, salesItems: 0, returnsAggregate: 0, returnsItems: 0 },
      unmatchedCatalogGuids: [],
      parity: { groupCountAggregate: 1, groupCountItemsRolledUp: 1, onlyAggregate: 0, onlyItems: 0, metricMismatches: 1 },
      returnsParity: {
        groupCountAggregate: 0,
        groupCountItemsRolledUp: 0,
        onlyAggregate: 0,
        onlyItems: 0,
        quantityIncomeMismatches: 0,
        parityOk: true,
      },
    });
    assert.equal(ok, false);
  });
});
