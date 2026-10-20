import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { normalizeSaleMonth } from "../../src/onec-sales/sale-month";
import { buildSaleJsonBytes, buildSaleRecord, LEGAL_A } from "../helpers/legal-sales-fixtures";

describe("legal sales month normalization", () => {
  it("normalizes 1C month timestamp to YYYY-MM without timezone shift", () => {
    const parsed = normalizeSaleMonth("2026-09-01T00:00:00");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.yyyyMm, "2026-09");
  });
});

describe("legal sales parse", () => {
  it("accepts negative discounts and profit values", () => {
    const parsed = parseLegalSalesJsonBytes(
      buildSaleJsonBytes([
        buildSaleRecord({
          legalGuid: LEGAL_A,
          type: "Фурнитура (ручки)",
          income: 100,
          totalDiscount: -10,
          grossProfit: -50,
          profitability: -12.5,
        }),
      ]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.roster.lines[0]?.grossProfit, "-50");
  });

  it("rejects duplicate key with conflicting values", () => {
    const parsed = parseLegalSalesJsonBytes(
      buildSaleJsonBytes([
        buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", income: 100 }),
        buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", income: 200 }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "DUPLICATE_KEY_CONFLICT");
  });

  it("rejects invalid guid_team_leader style invalid legal guid", () => {
    const parsed = parseLegalSalesJsonBytes(
      buildSaleJsonBytes([buildSaleRecord({ legalGuid: "not-a-guid", type: "A" })]),
    );
    assert.equal(parsed.ok, false);
  });

  it("rejects conflicting month fields", () => {
    const row = buildSaleRecord({ legalGuid: LEGAL_A, type: "A", month: "2026-09-01T00:00:00" });
    (row.sale_info as Record<string, unknown>).month = "2026-08-01T00:00:00";
    const parsed = parseLegalSalesJsonBytes(buildSaleJsonBytes([row]));
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "MONTH_FIELD_CONFLICT");
  });
});
