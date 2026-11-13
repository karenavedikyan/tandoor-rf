import type { PoolClient } from "pg";
import { parseProductsJson, type ParsedSnapshot, type Product } from "../internal-catalog/model";
import { loadSnapshot, writeSnapshot } from "../internal-catalog/repository";
import { addIssue, consensus, hash, type Prepared } from "./model";

/** Retain products absent from the next file; keep exact source variants in evidence. */
export async function projectCatalog(db: PoolClient, p: Prepared): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1)", [902_451_017]);
  const current = await loadSnapshot(db);
  const products = new Map<string, Product>(current ? (await db.query<{ record: Product }>(
    "SELECT record FROM internal_catalog_products WHERE snapshot_id=$1", [current.id],
  )).rows.map(x => [x.record.guid, x.record]) : []);
  for (const [id, rows] of p.groups.products) {
    try {
      const parsed = parseProductsJson(Buffer.from(JSON.stringify([consensus(rows)])));
      products.set(id, parsed.products[0]);
    } catch {
      addIssue(p, rows[0], "properties/files", "INVALID_PRODUCT",
        "Не все данные товара можно применить. Исходные варианты сохранены для проверки.", rows.map(row => row.index));
    }
  }
  if (!products.size) return;
  const rows = [...products.values()].sort((a, b) => a.guid.localeCompare(b.guid));
  // Per-product validation is isolated: one source error must not reject the rest of the catalogue.
  const summaries = rows.map(product => parseProductsJson(Buffer.from(JSON.stringify([product]))).summary);
  const sections = new Map(summaries.flatMap(s => s.sections).map(s => [s.guid, s]));
  const parsed: ParsedSnapshot = { sha256: hash(JSON.stringify(rows)), products: rows, summary: {
    products: rows.length, sections: [...sections.values()], brands: [...new Set(summaries.flatMap(s => s.brands))].sort(),
    propertyValues: summaries.reduce((n, s) => n + s.propertyValues, 0),
    imagePaths: summaries.reduce((n, s) => n + s.imagePaths, 0),
    productsWithImagePaths: summaries.reduce((n, s) => n + s.productsWithImagePaths, 0),
    textsAt1024: summaries.reduce((n, s) => n + s.textsAt1024, 0),
    emptyValues: summaries.reduce((n, s) => n + s.emptyValues, 0),
  } };
  const snapshot = await writeSnapshot(db, parsed, "Обновление 1С: products.json");
  // loadSnapshot historically used import time as active ordering; reactivation also works for A→B→A.
  await db.query("UPDATE internal_catalog_snapshots SET imported_at=clock_timestamp() WHERE id=$1", [snapshot.snapshotId]);
}
