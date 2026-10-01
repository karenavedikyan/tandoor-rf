import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyCatalogImport, clearCatalogApplyBlockForOperator } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { resetPoolForTests } from "../../src/db/pool";
import {
  buildMinimalCatalogXmlSet,
  catalogEntriesFromXmlSet,
  manifestFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

async function validatedCatalogFromXmlSet(xmlSet: ReturnType<typeof buildMinimalCatalogXmlSet>) {
  const entries = catalogEntriesFromXmlSet(xmlSet);
  const parsed = await parseCatalogSet(
    entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
  );
  assert.equal(parsed.ok, true);
  const validated = validateCatalogSet(parsed.data!);
  assert.equal(validated.ok, true);
  return validated.data!;
}

describe("onec catalog apply safety", { concurrency: false }, () => {
  let pool: Pool;
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  beforeEach(async () => {
    await resetPoolForTests();
    await pool.query(`
      TRUNCATE onec_catalog_quarantine,
               onec_catalog_prices_staging,
               onec_catalog_stock_staging,
               onec_catalog_stock_expected_staging,
               onec_catalog_product_presence,
               onec_catalog_product_sections,
               onec_catalog_product_properties,
               onec_catalog_product_images,
               onec_catalog_products,
               onec_catalog_price_types,
               onec_catalog_storages,
               onec_catalog_sections,
               onec_catalog_groups,
               onec_catalog_import_runs,
               onec_catalog_versions
      RESTART IDENTITY CASCADE;
      UPDATE onec_catalog_state
      SET active_version_id = NULL,
          last_successful_manifest_sha256 = NULL,
          apply_blocked = FALSE,
          apply_blocked_reason = NULL
      WHERE id = 1;
    `);
  });

  after(async () => {
    await resetPoolForTests();
    await pool.end();
  });

  it("persists attribute-based commercial raw and numeric values", async () => {
    const data = await validatedCatalogFromXmlSet(buildMinimalCatalogXmlSet());
    const applied = await applyCatalogImport(databaseUrl, data);
    assert.equal(applied.ok, true);

    const price = await pool.query<{ price_raw: string; price_numeric: string; quarantined: boolean }>(
      `SELECT price_raw, price_numeric::text, quarantined
       FROM onec_catalog_prices_staging
       WHERE price_type_code = 'pt1' AND product_code = 'p1'`,
    );
    assert.equal(price.rows[0]?.price_raw, "347,39");
    assert.equal(price.rows[0]?.price_numeric, "347.3900");
    assert.equal(price.rows[0]?.quarantined, false);

    const stock = await pool.query<{ quantity_raw: string; quantity_numeric: string }>(
      `SELECT quantity_raw, quantity_numeric::text
       FROM onec_catalog_stock_staging
       WHERE product_code = 'p1' AND storage_code = 'wh1'`,
    );
    assert.equal(stock.rows[0]?.quantity_raw, "10,5");
    assert.equal(stock.rows[0]?.quantity_numeric, "10.5000");
  });

  it("rejects empty base catalog", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = `<?xml version="1.0" encoding="UTF-8"?><Товары/>`;
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    const validated = validateCatalogSet(parsed.data!);
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.ok(validated.issues.some((issue) => issue.code === "EMPTY_CATALOG"));
    }
  });

  it("blocks apply when apply_blocked is set and does not switch active version", async () => {
    const data = await validatedCatalogFromXmlSet(buildMinimalCatalogXmlSet());
    const first = await applyCatalogImport(databaseUrl, data);
    assert.equal(first.ok, true);

    const activeBefore = await pool.query<{ active_version_id: string | null }>(
      "SELECT active_version_id FROM onec_catalog_state WHERE id = 1",
    );
    await pool.query(
      `UPDATE onec_catalog_state
       SET apply_blocked = TRUE, apply_blocked_reason = 'operator hold'
       WHERE id = 1`,
    );

    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
      "Product one",
      "Product one updated",
    );
    const changed = await validatedCatalogFromXmlSet(xmlSet);
    const blocked = await applyCatalogImport(databaseUrl, changed);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.code, "APPLY_BLOCKED");
    }

    const activeAfter = await pool.query<{ active_version_id: string | null }>(
      "SELECT active_version_id FROM onec_catalog_state WHERE id = 1",
    );
    assert.equal(activeAfter.rows[0]?.active_version_id, activeBefore.rows[0]?.active_version_id);
  });

  it("blocks further apply after commit response loss until operator clears block", async () => {
    const dataA = await validatedCatalogFromXmlSet(buildMinimalCatalogXmlSet());
    await applyCatalogImport(databaseUrl, dataA);

    const xmlSetB = buildMinimalCatalogXmlSet();
    xmlSetB["catalog/products/data.xml"] = xmlSetB["catalog/products/data.xml"].replace(
      "Product two",
      "Product two revised",
    );
    const dataB = await validatedCatalogFromXmlSet(xmlSetB);

    const uncertain = await applyCatalogImport(databaseUrl, dataB, {
      testHooks: { failCommit: true },
    });
    assert.equal(uncertain.ok, false);
    if (!uncertain.ok) {
      assert.equal(uncertain.code, "COMMIT_UNCERTAIN");
    }

    const blocked = await pool.query<{ apply_blocked: boolean }>(
      "SELECT apply_blocked FROM onec_catalog_state WHERE id = 1",
    );
    assert.equal(blocked.rows[0]?.apply_blocked, true);

    const blockedApply = await applyCatalogImport(databaseUrl, dataB);
    assert.equal(blockedApply.ok, false);
    if (!blockedApply.ok) {
      assert.equal(blockedApply.code, "APPLY_BLOCKED");
    }

    await clearCatalogApplyBlockForOperator(databaseUrl);
    await pool.query(
      `UPDATE onec_catalog_import_runs
       SET status = 'failed', finished_at = NOW(), error_code = 'COMMIT_UNCERTAIN'
       WHERE status = 'running'`,
    );

    const recovered = await applyCatalogImport(databaseUrl, dataB, {
      readAt: new Date().toISOString(),
    });
    assert.equal(recovered.ok, true);
  });

  it("detects conflicting duplicate product properties before apply", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
      `<Свойство Код="type" Название="Тип товара" Значение="Складская"/>`,
      `<Свойство Код="type" Название="Тип товара" Значение="Складская"/>
      <Свойство Код="type" Название="Тип товара" Значение="Другая"/>`,
    );
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.ok(parsed.issues.some((issue) => issue.code === "CONFLICTING_PROPERTY"));
    }
  });
});
