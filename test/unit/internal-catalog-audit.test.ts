import assert from "node:assert/strict";
import { it } from "node:test";
import { auditCatalog } from "../../src/internal-catalog/audit";
import { buildCatalogContext } from "../../src/internal-catalog/presentation";
import { avallonSizeVariantsFixture, sizeVariantsFixture, fixtureGuid as g } from "../helpers/internal-catalog-fixtures";

it("audits every GUID and splits only prices, not differing configuration attributes", () => {
  const products = sizeVariantsFixture();
  products.forEach((p, i) => {
    p.properties.push({ guid: g(990), name: "Гарантийный срок", value: "Гарантия " + i });
    p.properties.push({ guid: g(991), name: "Вид утеплителя", value: i === 3 ? "Минеральная вата" : "Минеральная плита" });
  });
  const context = buildCatalogContext(products.map((p, i) => ({
    file_key: "prices", imported_at: "2026-11-14T08:00:00Z",
    record: { guid: p.guid, type_price: [{ guid: g(800), name: "РРЦ Тандор", price: i === 2 ? 200 : 100 }] },
  })));
  const before = JSON.stringify(products), report = auditCatalog(products, context, g(800));
  assert.equal(report.products, 4); assert.equal(report.cards, 2);
  assert.equal(report.ruleViolations, 0);
  assert.deepEqual(report.coverage, { assigned: 4, unique: 4, ok: true });
  assert.equal(report.unresolvedModels, 1); assert.equal(report.unexplainedModels, 0);
  assert.deepEqual(report.unresolved[0].fields, ["Вид утеплителя"]);
  assert.deepEqual(report.unresolved[0].reasons, ["different_price"]);
  assert.equal(report.unresolved[0].variants.length, 4);
  assert.equal(JSON.stringify(products), before);
});
it("covers empty snapshots and ineligible products without dropping GUIDs", () => {
  const context = buildCatalogContext([]);
  assert.equal(auditCatalog([], context, g(800)).coverage.ok, true);
  const products = sizeVariantsFixture();
  products[0].properties = products[0].properties.filter(p => p.name !== "Размер, мм");
  products[1].properties = products[1].properties.filter(p => p.name !== "СсылкаНаГлавную");
  products[2].name = "Образец без исходного размера";
  const report = auditCatalog(products, context, g(800));
  assert.equal(report.coverage.ok, true);
  assert.equal(report.ineligible.invalidSize, 1);
  assert.equal(report.ineligible.missingLink, 1);
  assert.equal(report.ineligible.dimensionMismatch, 0);
  assert.equal(report.ineligible.unknownPrice, 4);
});
it("reports no grouping violation when different physical attributes remain inside one card", () => {
  const products = avallonSizeVariantsFixture();
  const context = buildCatalogContext(products.map(p => ({
    file_key: "prices", imported_at: "2026-11-14T08:00:00Z",
    record: { guid: p.guid, type_price: [{ guid: g(800), name: "РРЦ Тандор", price: 57900 }] },
  })));
  const grouped = auditCatalog(products, context, g(800));
  assert.equal(grouped.cards, 1);
  assert.equal(grouped.unresolvedModels, 0);
  assert.deepEqual(grouped.coverage, { assigned: 2, unique: 2, ok: true });
  products.forEach((p, i) => p.properties.push({ guid: g(982), name: "Вид утеплителя", value: i ? "Вата" : "Плита" }));
  const separated = auditCatalog(products, context, g(800));
  assert.equal(separated.cards, 1);
  assert.equal(separated.ruleViolations, 0);
  assert.equal(separated.unresolvedModels, 0);
});
it("audits each price type independently, explaining duplicate sizes and unknown/conflicting prices", () => {
  const products = sizeVariantsFixture();
  products.push({ ...structuredClone(products[0]), guid: g(99) });
  const context = buildCatalogContext(products.map((p, i) => ({
    file_key: "prices", imported_at: "2026-11-14T08:00:00Z",
    record: { guid: p.guid, type_price: [
      { guid: g(800), name: "РРЦ Тандор", price: 100 },
      { guid: g(801), name: "Минимальная", price: i === 3 ? 200 : 100 },
    ] },
  })));
  for (const type of context.priceTypes) {
    const report = auditCatalog(products, context, type.guid);
    assert.deepEqual(report.coverage, { assigned: 5, unique: 5, ok: true });
    assert.equal(report.reasonCounts.duplicate_size ?? 0, 0);
    assert.equal(report.ruleViolations, 0);
    assert.equal(report.cards, type.guid === g(801) ? 2 : 1);
    assert.equal(report.unexplainedModels, 0);
    assert.equal(report.reasonCounts.different_price ?? 0, type.guid === g(801) ? 1 : 0);
  }
  context.commerce.get(g(2))!.prices.find(p => p.guid === g(800))!.conflict = true;
  context.commerce.get(g(3))!.prices.find(p => p.guid === g(800))!.value = null;
  const report = auditCatalog(products, context, g(800));
  assert.equal(report.coverage.ok, true);
  assert.equal(report.ineligible.conflictingPrice, 1);
  assert.equal(report.ineligible.unknownPrice, 1);
  assert.deepEqual(report.unresolved[0].reasons, ["unknown_price", "conflicting_price"]);
});
