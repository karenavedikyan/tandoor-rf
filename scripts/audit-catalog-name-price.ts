/** Offline read-only audit. No DB, network, env, import or source writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseProductsJson, normalizeSearch } from "../src/internal-catalog/model";
import { buildCatalogContext, commerceFor, type SourceRow } from "../src/internal-catalog/presentation";
import { productFamilies, productModelName } from "../src/internal-catalog/variants";
import { auditCatalog } from "../src/internal-catalog/audit";

async function main() {
  const [productsPath, pricesPath, stocksPath] = process.argv.slice(2);
  if (!productsPath || !pricesPath) throw new Error("Usage: tsx scripts/audit-catalog-name-price.ts products.json price.json [stock.json]");
  const paths = [productsPath, pricesPath, ...(stocksPath ? [stocksPath] : [])];
  const bytes = await Promise.all(paths.map(p => readFile(p)));
  const hashes = bytes.map(b => createHash("sha256").update(b).digest("hex"));
  const parsed = parseProductsJson(bytes[0]), products = parsed.products;
  const rows: SourceRow[] = [];
  for (const [index, file_key] of ["prices", "stocks"].entries()) {
    if (!bytes[index + 1]) continue;
    for (const record of JSON.parse(bytes[index + 1].toString("utf8"))) rows.push({
      file_key, record, imported_at: "2026-11-14T00:00:00Z",
    });
  }
  const context = buildCatalogContext(rows), original = JSON.stringify(products);
  const reports = context.priceTypes.map(type => {
    const families = productFamilies(products, context, type.guid), report = auditCatalog(products, context, type.guid);
    const expected = new Map<string, string[]>();
    for (const p of products) {
      const price = commerceFor(context, p.guid).prices.find(v => v.guid === type.guid);
      const key = price && !price.conflict && price.value !== null ?
        JSON.stringify([normalizeSearch(productModelName(p)), price.value]) : p.guid;
      const group = expected.get(key) ?? []; group.push(p.guid); expected.set(key, group);
    }
    assert.equal(families.length, expected.size, type.name + ": exactly one card per name/price key");
    const assigned = families.flatMap(f => f.products.map(p => p.guid));
    assert.deepEqual([...assigned].sort(), products.map(p => p.guid).sort(), type.name + ": all GUIDs exactly once");
    for (const family of families) {
      const first = family.products[0], price = commerceFor(context, first.guid).prices.find(v => v.guid === type.guid);
      const key = price && !price.conflict && price.value !== null ?
        JSON.stringify([normalizeSearch(productModelName(first)), price.value]) : first.guid;
      assert.deepEqual(family.products.map(p => p.guid).sort(), expected.get(key)!.slice().sort());
    }
    assert.equal(report.ruleViolations, 0);
    assert.equal(report.coverage.ok, true);
    const zefir = families.filter(f => f.products.some(p => /^500 Зефир ДГ /i.test(p.name)));
    return { name: type.name, products: products.length, cards: families.length,
      groupedCards: report.groupedCards, coverage: report.coverage, ruleViolations: report.ruleViolations,
      unknownPrices: report.ineligible.unknownPrice, conflictingPrices: report.ineligible.conflictingPrice,
      zefir: zefir.map(f => ({ name: f.modelName ?? f.products[0].name, guids: f.products.map(p => p.guid) })) };
  });
  assert.equal(JSON.stringify(products), original, "all source product objects unchanged");
  const afterHashes = await Promise.all(paths.map(async p => createHash("sha256").update(await readFile(p)).digest("hex")));
  assert.deepEqual(afterHashes, hashes, "source files unchanged");
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), scope: "offline source files, not production",
    sources: paths.map((path, i) => ({ path, sha256: hashes[i] })), sourceUnchanged: true, reports }, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
