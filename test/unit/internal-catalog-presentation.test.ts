import assert from "node:assert/strict";
import { it } from "node:test";
import { buildCatalogContext, commerceFor, groupDescendants, productPresentation, type SourceRow } from "../../src/internal-catalog/presentation";
import { catalogueFixture, fixtureGuid as g } from "../helpers/internal-catalog-fixtures";
const row = (file_key: string, record: SourceRow["record"]): SourceRow => ({ file_key, record, imported_at: "2026-11-14T08:00:00Z" });
it("projects explicit prices/warehouses without adding identical duplicates or guessing malformed numbers", () => {
  const price = row("prices", { guid: g(1), type_price: [{ guid: g(50), name: "РРЦ Тандор", price: 0 }] });
  const stock = row("stocks", { guid: g(1), warehouse: [{ guid: g(60), name: "Склад", quantity: 12 }] });
  const context = buildCatalogContext([price, price, stock, stock]);
  assert.equal(commerceFor(context, g(1)).prices[0].value, 0);
  assert.equal(commerceFor(context, g(1)).quantity, 12);
  assert.equal(context.priceTypes[0].name, "РРЦ Тандор");
  for (const value of ["12", -1, null, Infinity]) {
    const bad = buildCatalogContext([stock, row("stocks", { guid: g(1), warehouse: [{ guid: g(60), name: "Склад", quantity: value }] })]);
    assert.equal(commerceFor(bad, g(1)).quantity, null);
    assert.equal(commerceFor(bad, g(1)).warehouses[0].conflict, true);
  }
});
it("marks conflicting prices/names and absent commerce unknown rather than zero", () => {
  const context = buildCatalogContext([
    row("prices", { guid: g(1), type_price: [{ guid: g(50), name: "Тип", price: 10 }] }),
    row("prices", { guid: g(1), type_price: [{ guid: g(50), name: "Тип", price: 11 }] }),
    row("stocks", { guid: g(1), warehouse: [] }),
  ]);
  assert.equal(commerceFor(context, g(1)).prices[0].value, null);
  assert.equal(commerceFor(context, g(1)).quantity, null);
  assert.equal(commerceFor(context, g(2)).quantity, null);
});
it("breaks cycles and missing parents while retaining every source group", () => {
  const context = buildCatalogContext([
    row("groups", { guid_group: g(1), name_group: "A", owner_group: g(2) }),
    row("groups", { guid_group: g(2), name_group: "B", owner_group: g(1) }),
    row("groups", { guid_group: g(3), name_group: "C", owner_group: g(999) }),
    row("groups", { guid_group: g(4), name_group: "D", owner_group: g(4) }),
  ]);
  assert.equal(context.groups.length, 4);
  assert.equal(context.groups.find(x => x.guid === g(3))?.parent, null);
  assert.equal(context.groups.find(x => x.guid === g(4))?.parent, null);
  assert.ok(groupDescendants(context.groups, g(1)).length <= 2);
});
it("returns only allowlisted descriptive facets and photo identities, never filesystem paths", () => {
  const product = catalogueFixture(1)[0];
  product.properties.push({ guid: g(999), name: "Цвет", value: "Белый" });
  const result = productPresentation(product);
  assert.deepEqual(result.properties.map(x => x.name), ["Цвет"]);
  assert.equal("path" in result.files[0], false);
  assert.deepEqual(result.flags, { new: false, hit: false, sale: false });
});
