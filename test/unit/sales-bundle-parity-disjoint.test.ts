import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeSalesBundle } from "../../src/onec-sales/bundle-analyze";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { buildReturnRecord } from "../helpers/sales-bundle-fixtures";

describe("returns parity disjoint groups", () => {
  it("flags onlyAggregate and onlyItems", () => {
    const report = analyzeSalesBundle({
      salesAggregate: { sourceSha256: "a", lines: [], lineCount: 0 },
      salesItems: { sourceSha256: "b", lines: [], lineCount: 0 },
      returnsAggregate: {
        sourceSha256: "c",
        lineCount: 1,
        lines: [
          {
            sourceRowIndex: 0,
            legalGuid: LEGAL_A,
            saleMonthYyyyMm: "2026-09",
            saleMonthStartIso: "2026-09-01",
            productType: "Входные двери",
            quantity: "-1",
            income: "-10",
          },
        ],
      },
      returnsItems: {
        sourceSha256: "d",
        lineCount: 1,
        lines: [
          {
            sourceRowIndex: 0,
            legalGuid: LEGAL_B,
            saleMonthYyyyMm: "2026-09",
            saleMonthStartIso: "2026-09-01",
            productType: "Входные двери",
            guidItem: "d1000000-0000-4000-8000-000000000001",
            nameItem: "SKU",
            quantity: "-2",
            income: "-20",
          },
        ],
      },
      knownCatalogLegalGuids: new Set([LEGAL_A, LEGAL_B]),
    });
    assert.equal(report.returnsParity.onlyAggregate, 1);
    assert.equal(report.returnsParity.onlyItems, 1);
    assert.equal(report.returnsParity.parityOk, false);
  });
});
