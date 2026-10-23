import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeSalesBundle } from "../../src/onec-sales/bundle-analyze";
import {
  addSaleMoneyStrings,
  addSaleQuantityStrings,
  parseSaleQuantityString,
  saleMoneyStringsExactEqual,
  saleQuantityStringsExactEqual,
  saleQuantityWithinTolerance,
} from "../../src/onec-sales/decimal-sum";
import { LEGAL_B } from "../helpers/legal-sales-fixtures";
import {
  buildAlignedSalesBundleBuffers,
  buildReturnRecord,
  buildSaleItemRecord,
} from "../helpers/sales-bundle-fixtures";
import { buildSaleJsonBytes, buildSaleRecord, LEGAL_A } from "../helpers/legal-sales-fixtures";
import { parseLegalReturnItemsJsonBytes } from "../../src/onec-sales/parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "../../src/onec-sales/parse-returne-json";
import { parseLegalSaleItemsJsonBytes } from "../../src/onec-sales/parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";

describe("decimal-sum exact", () => {
  it("sums return money without float drift", () => {
    const sum = addSaleMoneyStrings(["-0.1", "-0.2"]);
    assert.equal(saleMoneyStringsExactEqual(sum, "-0.3"), true);
  });

  it("sums fractional quantity at scale 6", () => {
    const sum = addSaleQuantityStrings(["2.5", "12.5"]);
    assert.equal(sum, "15.000000");
  });

  it("accepts canonical scale6 quantity strings for equality", () => {
    const sum = addSaleQuantityStrings(["-1", "-1"]);
    assert.equal(sum, "-2.000000");
    assert.equal(saleQuantityWithinTolerance("-2", sum), true);
    assert.equal(saleQuantityStringsExactEqual("-2", sum), true);
    assert.equal(parseSaleQuantityString("-2.000000").ok, true);
  });

  it("does not drop leading quantity when adding canonical strings", () => {
    const sum = addSaleQuantityStrings(["3.000000", "4"]);
    assert.equal(sum, "7.000000");
  });
});

describe("returns bundle quantity parity", () => {
  it("matches multi-line fractional returns in aligned tiny bundle", () => {
    const bundle = buildAlignedSalesBundleBuffers();
    const salesAgg = parseLegalSalesJsonBytes(bundle.saleAggregate);
    const salesItems = parseLegalSaleItemsJsonBytes(bundle.saleItems);
    const retAgg = parseLegalReturnsJsonBytes(bundle.returnsAggregate);
    const retItems = parseLegalReturnItemsJsonBytes(bundle.returnItems);
    assert.equal(salesAgg.ok && salesItems.ok && retAgg.ok && retItems.ok, true);
    if (!salesAgg.ok || !salesItems.ok || !retAgg.ok || !retItems.ok) return;
    const report = analyzeSalesBundle({
      salesAggregate: salesAgg.roster,
      salesItems: salesItems.roster,
      returnsAggregate: retAgg.roster,
      returnsItems: retItems.roster,
      knownCatalogLegalGuids: new Set([LEGAL_A.toLowerCase(), LEGAL_B.toLowerCase()]),
    });
    assert.equal(report.returnsParity.parityOk, true);
    assert.equal(report.returnsParity.quantityIncomeMismatches, 0);
  });

  it("matches aggregate -2 qty with two fractional item lines", () => {
    const aggregate = parseLegalReturnsJsonBytes(
      Buffer.from(
        buildSaleJsonBytes([
          buildReturnRecord({ legalGuid: LEGAL_B, quantity: -2, income: -0.3 }),
        ])
          .toString()
          .replaceAll("sale_info", "returne_info"),
      ),
    );
    const items = parseLegalReturnItemsJsonBytes(
      Buffer.from(
        buildSaleJsonBytes([
          buildReturnRecord({
            legalGuid: LEGAL_B,
            withItems: true,
            quantity: -1,
            income: -0.1,
          }),
          buildReturnRecord({
            legalGuid: LEGAL_B,
            withItems: true,
            quantity: -1,
            income: -0.2,
          }),
        ])
          .toString()
          .replaceAll("sale_info", "returne_info"),
      ),
    );
    assert.equal(aggregate.ok && items.ok, true);
    if (!aggregate.ok || !items.ok) return;
    const rolledQty = addSaleQuantityStrings(["-1", "-1"]);
    assert.equal(saleQuantityStringsExactEqual(aggregate.roster.lines[0].quantity, rolledQty), true);
    const rolledIncome = addSaleMoneyStrings(["-0.1", "-0.2"]);
    assert.equal(saleMoneyStringsExactEqual(aggregate.roster.lines[0].income, rolledIncome), true);
  });
});
