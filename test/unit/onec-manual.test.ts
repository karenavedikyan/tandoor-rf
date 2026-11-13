import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareManualBundle, consensus, FILES } from "../../src/onec-manual/model";
import { readManualFiles } from "../../src/onec-manual/read";
import { prepareSales } from "../../src/onec-manual/sales";
import { manualFixture, fixtureGuid } from "../helpers/onec-manual-fixtures";
import { buildSaleRecord } from "../helpers/legal-sales-fixtures";
describe("manual 1C source integrity", () => {
  it("retains conflicts without choosing first/last; no manifest", () => {
    const rows = [1, 2].map(x => ({ guid_client: fixtureGuid(601), name_client: "Клиент", inn: String(x) }));
    const p = prepareManualBundle(manualFixture({ clients: rows }));
    assert.equal(p.counts.clients, 2);
    assert.equal(consensus(p.groups.clients.get(fixtureGuid(601))!).inn, undefined);
    assert.ok(p.issues.some(issue => issue.code === "DUPLICATE_GUID"));
    assert.equal(prepareManualBundle(manualFixture({ clients: rows.slice().reverse() })).issues.length, p.issues.length);
  });
  it("rejects corrupt JSON but accepts malformed records as reviewable evidence", () => {
    const files = manualFixture({ clients: [null, { name_client: "<script>attack</script>" }] });
    assert.equal(prepareManualBundle(files).counts.clients, 2);
    files.clients.bytes = Buffer.from("[broken");
    assert.throws(() => prepareManualBundle(files), /INVALID_JSON/);
  });
  it("requires all twelve stable files and checks a second pinned read", async () => {
    const files = manualFixture(), byPath = new Map(Object.values(files).map(f => [f.sourceName, f.bytes]));
    let calls = 0;
    await readManualFiles({ reader: async p => { calls++; const b = byPath.get(p); if (!b) throw Error("missing"); return b; } });
    assert.equal(calls, 24);
    calls = 0;
    await assert.rejects(readManualFiles({ reader: async p => {
      calls++; return calls <= Object.keys(FILES).length ? byPath.get(p)! : Buffer.from("[] changed");
    } }), /BUNDLE_UNSTABLE/);
    byPath.delete(files.stocks.sourceName);
    await assert.rejects(readManualFiles({ reader: async p => { const b = byPath.get(p); if (!b) throw Error("missing"); return b; } }), /SOURCE_UNREADABLE/);
  });
  it("flags exact and conflicting aggregate repeats without multiplying totals", () => {
    const row = buildSaleRecord({ legalGuid: fixtureGuid(601), type: "A", income: 100 });
    let p = prepareManualBundle(manualFixture({ sales: [row, row] }));
    assert.equal(prepareSales(p).sales.lines.length, 1);
    assert.ok(p.issues.some(x => x.code === "DUPLICATE_SALES_KEY"));
    p = prepareManualBundle(manualFixture({ sales: [row, buildSaleRecord({ legalGuid: fixtureGuid(601), type: "A", income: 200 })] }));
    assert.equal(prepareSales(p).sales.lines.length, 0);
  });
});
