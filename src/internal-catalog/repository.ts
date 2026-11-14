import type { Pool, PoolClient } from "pg";
import type { ParsedSnapshot, Product, Summary } from "./model";
import { normalizeSearch, propertyValue, searchText } from "./model";
import { commerceFor, groupDescendants, productPresentation, type CatalogContext } from "./presentation";

export type Snapshot = { id: string; sha256: string; sourceName: string; importedAt: string; summary: Summary };
type DbSnapshot = { id: string; sha256: string; source_name: string; imported_at: Date; summary: Summary };
const dto = (row: DbSnapshot): Snapshot => ({
  id: row.id, sha256: row.sha256, sourceName: row.source_name, importedAt: row.imported_at.toISOString(), summary: row.summary,
});
export async function loadSnapshot(db: Pool | PoolClient, id?: string): Promise<Snapshot | null> {
  const result = await db.query<DbSnapshot>(`SELECT id,sha256,source_name,imported_at,summary
    FROM internal_catalog_snapshots ${id ? "WHERE id=$1::uuid" : ""}
    ORDER BY imported_at DESC,id DESC LIMIT 1`, id ? [id] : []);
  return result.rows[0] ? dto(result.rows[0]) : null;
}
/** Only this isolated reference store is written; XML/business catalogue tables are never touched. */
export async function importSnapshot(pool: Pool, parsed: ParsedSnapshot, sourceName: string, expectedSha: string, firstOnly = false) {
  if (expectedSha !== parsed.sha256) throw new Error("HASH_MISMATCH");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [902_451_017]);
    if (firstOnly && (await client.query("SELECT id FROM internal_catalog_snapshots LIMIT 1")).rowCount) {
      throw new Error("CATALOG_NOT_EMPTY");
    }
    const result = await writeSnapshot(client, parsed, sourceName);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
/** Caller owns transaction and activation. No nested transaction/commit. */
export async function writeSnapshot(client: PoolClient, parsed: ParsedSnapshot, sourceName: string) {
    const existing = await client.query<{ id: string }>("SELECT id FROM internal_catalog_snapshots WHERE sha256=$1", [parsed.sha256]);
    if (existing.rows[0]) {
      return { status: "unchanged", snapshotId: existing.rows[0].id, products: parsed.products.length };
    }
    const id = (await client.query<{ id: string }>(`INSERT INTO internal_catalog_snapshots
      (sha256,source_name,summary,product_count) VALUES($1,$2,$3::jsonb,$4) RETURNING id`,
      [parsed.sha256, sourceName, JSON.stringify(parsed.summary), parsed.products.length])).rows[0].id;
    for (let offset = 0; offset < parsed.products.length; offset += 250) {
      const batch = parsed.products.slice(offset, offset + 250).map(product => ({
        guid: product.guid, name: product.name, brand: propertyValue(product, "Бренд") ?? "",
        section_guids: product.chapter.map(x => x.guid), search_text: searchText(product), record: product,
      }));
      await client.query(`INSERT INTO internal_catalog_products(snapshot_id,guid,name,brand,section_guids,search_text,record)
        SELECT $1::uuid,x.guid,x.name,x.brand,x.section_guids,x.search_text,x.record
        FROM jsonb_to_recordset($2::jsonb)
        AS x(guid uuid,name text,brand text,section_guids uuid[],search_text text,record jsonb)`, [id, JSON.stringify(batch)]);
    }
    return { status: "imported", snapshotId: id, products: parsed.products.length };
}
export type Search = { q: string; section: string; brand: string; page: number; pageSize: number;
  group?: string; properties?: Record<string, string[]>; priceType?: string; min?: number; max?: number;
  availability?: string; flag?: string; sort?: string };
export function listItem(product: Product) {
  return { guid: product.guid, name: product.name, sections: product.chapter, brand: propertyValue(product, "Бренд"),
    article: propertyValue(product, "Артикул"), imagePathCount: product.files.length,
    coverFileGuid: product.files[0]?.guid ?? null, ...productPresentation(product) };
}
export async function searchProducts(db: Pool | PoolClient, snapshotId: string, search: Search, context?: CatalogContext) {
  const values: unknown[] = [snapshotId], clauses = ["snapshot_id=$1::uuid"];
  function where(sql: string, value: unknown) { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); }
  let from = "internal_catalog_products c";
  if (context) {
    const rows = [...context.commerce].map(([guid, item]) => ({ guid, quantity: item.quantity,
      price: item.prices.find(p => p.guid === search.priceType)?.value ?? null }));
    values.push(JSON.stringify(rows));
    from += ` LEFT JOIN jsonb_to_recordset($2::jsonb) AS commerce(product_guid uuid,price numeric,quantity numeric)
      ON commerce.product_guid=c.guid`;
    // The explicit alias prevents collision with the product GUID.
    values[1] = JSON.stringify(rows.map(({ guid, ...row }) => ({ ...row, product_guid: guid })));
  }
  // Every user token is a literal substring, never a LIKE wildcard.
  for (const token of normalizeSearch(search.q).split(" ").filter(Boolean)) {
    where("search_text LIKE ? ESCAPE '\\'", `%${token.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (search.section) where("?::uuid=ANY(section_guids)", search.section);
  if (search.brand) where("brand=?", search.brand);
  if (search.group) where("(record->>'guid_group')=ANY(?::text[])",
    groupDescendants(context?.groups ?? [], search.group));
  for (const [name, selected] of Object.entries(search.properties ?? {})) {
    values.push(name, selected);
    clauses.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(record->'properties') prop
      WHERE btrim(prop->>'name')=$${values.length - 1} AND btrim(prop->>'value')=ANY($${values.length}::text[]))`);
  }
  if (context && search.min !== undefined) where("commerce.price>=?", search.min);
  if (context && search.max !== undefined) where("commerce.price<=?", search.max);
  if (context && search.availability === "in") clauses.push("commerce.quantity>0");
  if (context && search.availability === "zero") clauses.push("commerce.quantity=0");
  if (context && search.availability === "unknown") clauses.push("commerce.quantity IS NULL");
  if (search.flag) {
    const name = { new: "Новинка", hit: "Хит продаж", sale: "Акция" }[search.flag];
    if (name) where(`EXISTS(SELECT 1 FROM jsonb_array_elements(record->'properties') prop
      WHERE btrim(prop->>'name')=? AND translate(lower(btrim(prop->>'value')),'ДАИСТН','даистн') IN ('да','истина','true','1'))`, name);
  }
  const predicate = clauses.join(" AND ");
  const total = Number((await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM ${from} WHERE ${predicate}`, values)).rows[0].count);
  const page = Math.min(search.page, Math.max(1, Math.ceil(total / search.pageSize)));
  const order = context ? { asc: "commerce.price ASC NULLS LAST,", desc: "commerce.price DESC NULLS LAST,",
    stock: "commerce.quantity DESC NULLS LAST," }[search.sort ?? ""] ?? "" : "";
  const records = await db.query<{ record: Product }>(`SELECT record FROM ${from}
    WHERE ${predicate} ORDER BY ${order}name,guid LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, search.pageSize, (page - 1) * search.pageSize]);
  return { snapshotId, total, page, pageSize: search.pageSize, items: records.rows.map(x => ({
    ...listItem(x.record), ...(context ? { commerce: commerceFor(context, x.record.guid) } : {}),
  })) };
}
export async function loadProduct(db: Pool | PoolClient, snapshotId: string, guid: string): Promise<Product | null> {
  const result = await db.query<{ record: Product }>(
    "SELECT record FROM internal_catalog_products WHERE snapshot_id=$1::uuid AND guid=$2::uuid", [snapshotId, guid]);
  return result.rows[0]?.record ?? null;
}
