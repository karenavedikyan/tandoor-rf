import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLegalReturnItemsJsonBytes } from "../../src/onec-sales/parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "../../src/onec-sales/parse-returne-json";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { parseLegalSaleItemsJsonBytes } from "../../src/onec-sales/parse-sale-items-json";
import { analyzeSalesBundle } from "../../src/onec-sales/bundle-analyze";
import { buildSaleJsonBytes, buildSaleRecord, LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { buildReturnRecord, buildSaleItemRecord } from "../helpers/sales-bundle-fixtures";

describe("sales bundle parsers (actual 1C contract)", () => {
  it("parses sale items with guid_item inside sale_info and fractional quantity", () => {
    const parsed = parseLegalSaleItemsJsonBytes(
      buildSaleJsonBytes([
        buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1.25, income: 10, nameItem: "Door <script>" }),
      ]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.roster.lines[0]?.quantity, "1.25");
    assert.equal(parsed.roster.lines[0]?.nameItem, "Door <script>");
  });

  it("parses returns with negative quantity/income and client_info.guid", () => {
    const parsed = parseLegalReturnsJsonBytes(
      Buffer.from(JSON.stringify([buildReturnRecord({ legalGuid: LEGAL_B, quantity: -3, income: -99 })])),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.roster.lines[0]?.quantity, "-3");
    assert.equal(parsed.roster.lines[0]?.income, "-99");
  });

  it("keeps all return aggregate rows for duplicate rollup keys", () => {
    const parsed = parseLegalReturnsJsonBytes(
      Buffer.from(
        JSON.stringify([
          buildReturnRecord({ legalGuid: LEGAL_B, type: "Фурнитура (ручки)", quantity: -1, income: -10 }),
          buildReturnRecord({ legalGuid: LEGAL_B, type: "Фурнитура (ручки)", quantity: -2, income: -20 }),
        ]),
      ),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.roster.lineCount, 2);
  });

  it("reports parity between aggregate and rolled-up items", () => {
    const agg = buildSaleJsonBytes([
      buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", quantity: 3, income: 300 }),
    ]);
    const items = buildSaleJsonBytes([
      buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 1, income: 100 }),
      buildSaleItemRecord({ legalGuid: LEGAL_A, quantity: 2, income: 200 }),
    ]);
    const parsedItems = parseLegalSaleItemsJsonBytes(items);
    assert.equal(parsedItems.ok, true);
    const rosterAgg = parseLegalSalesJsonBytes(agg);
    assert.equal(rosterAgg.ok, true);
    if (!rosterAgg.ok || !parsedItems.ok) return;
    const report = analyzeSalesBundle({
      salesAggregate: rosterAgg.roster,
      salesItems: parsedItems.roster,
      returnsAggregate: { sourceSha256: "a", lines: [], lineCount: 0 },
      returnsItems: { sourceSha256: "b", lines: [], lineCount: 0 },
      knownCatalogLegalGuids: new Set([LEGAL_A.toLowerCase()]),
    });
    assert.equal(report.parity.onlyAggregate, 0);
    assert.equal(report.parity.onlyItems, 0);
    assert.equal(report.parity.groupCountAggregate, 1);
    assert.equal(report.parity.groupCountItemsRolledUp, 1);
  });

  it("parses return items", () => {
    const parsed = parseLegalReturnItemsJsonBytes(
      Buffer.from(JSON.stringify([buildReturnRecord({ legalGuid: LEGAL_B, withItems: true })])),
    );
    assert.equal(parsed.ok, true);
  });
});
