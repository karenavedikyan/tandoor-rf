import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyCatalogImport, clearCatalogApplyBlockForOperator } from "../../src/onec-catalog/apply";
import { IMPORT_ADVISORY_LOCK_KEY } from "../../src/onec-catalog/constants";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { resetPoolForTests } from "../../src/db/pool";
import {
  buildHighPropertyCountProductsXml,
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

  it("blocks further apply after commit response loss before COMMIT is sent", async () => {
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

  it("returns success after COMMIT when the response is lost", async () => {
    const dataA = await validatedCatalogFromXmlSet(buildMinimalCatalogXmlSet());
    const first = await applyCatalogImport(databaseUrl, dataA);
    assert.equal(first.ok, true);

    const xmlSetB = buildMinimalCatalogXmlSet();
    xmlSetB["catalog/products/data.xml"] = xmlSetB["catalog/products/data.xml"].replace(
      "Product two",
      "Product two revised",
    );
    const dataB = await validatedCatalogFromXmlSet(xmlSetB);

    const result = await applyCatalogImport(databaseUrl, dataB, {
      testHooks: { failAfterCommit: true },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.runId);
      assert.ok(result.versionId);
      assert.equal(result.newProducts, 0);
      assert.equal(result.changedProducts, 1);
      assert.ok(result.cleanupWarning);
    }

    const journal = await pool.query<{ core_applied: boolean; status: string }>(
      `SELECT core_applied, status FROM onec_catalog_import_runs WHERE id = $1::uuid`,
      [result.ok ? result.runId : null],
    );
    assert.equal(journal.rows[0]?.core_applied, true);
    assert.ok(journal.rows[0]?.status === "success" || journal.rows[0]?.status === "partial");

    const active = await pool.query<{ manifest_sha256: string; is_active: boolean }>(
      `SELECT manifest_sha256, is_active FROM onec_catalog_versions WHERE id = $1::uuid`,
      [result.ok ? result.versionId : null],
    );
    assert.equal(active.rows[0]?.is_active, true);
    assert.equal(active.rows[0]?.manifest_sha256, dataB.manifest.manifestSha256);
  });

  it("blocks the next apply when a previous run is still running and recovery is unavailable", async () => {
    const data = await validatedCatalogFromXmlSet(buildMinimalCatalogXmlSet());
    await applyCatalogImport(databaseUrl, data);

    const xmlSetB = buildMinimalCatalogXmlSet();
    xmlSetB["catalog/products/data.xml"] = xmlSetB["catalog/products/data.xml"].replace(
      "Product one",
      "Product one changed",
    );
    const dataB = await validatedCatalogFromXmlSet(xmlSetB);

    await applyCatalogImport(databaseUrl, dataB, {
      testHooks: { failCommit: true, failRecovery: true },
    });

    await pool.query(
      `UPDATE onec_catalog_state SET apply_blocked = FALSE, apply_blocked_reason = NULL WHERE id = 1`,
    );

    const running = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_catalog_import_runs WHERE status = 'running'`,
    );
    assert.ok(Number(running.rows[0]?.count) >= 1);

    const blocked = await applyCatalogImport(databaseUrl, dataB);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.code, "APPLY_BLOCKED");
    }
  });

  it("returns IMPORT_LOCKED for concurrent apply attempts", async () => {
    const data = await validatedCatalogFromXmlSet(buildMinimalCatalogXmlSet());
    const locker = await pool.connect();
    try {
      await locker.query("SELECT pg_advisory_lock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
      const blocked = await applyCatalogImport(databaseUrl, data);
      assert.equal(blocked.ok, false);
      if (!blocked.ok) {
        assert.equal(blocked.code, "IMPORT_LOCKED");
      }
    } finally {
      await locker.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
      locker.release();
    }

    const applied = await applyCatalogImport(databaseUrl, data);
    assert.equal(applied.ok, true);
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

  it("rejects nested product XML instead of silently dropping the outer product", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="outer">
    <Товар Код="p2" Группа="g1" Активность="Y" Название="inner"/>
  </Товар>
</Товары>`;
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.ok(parsed.issues.some((issue) => issue.code === "INVALID_STRUCTURE"));
    }
  });

  it(
    "applies a catalog with on the order of 107k product properties via batch insert",
    { timeout: 600_000 },
    async () => {
      const xmlSet = buildMinimalCatalogXmlSet();
      xmlSet["catalog/products/data.xml"] = buildHighPropertyCountProductsXml(1079, 100);
      const startedAt = Date.now();
      const data = await validatedCatalogFromXmlSet(xmlSet);
      assert.equal(data.products.length, 1079);
      const propertyCount = data.products.reduce((sum, product) => sum + product.properties.length, 0);
      assert.equal(propertyCount, 107_900);

      const applied = await applyCatalogImport(databaseUrl, data);
      const elapsedMs = Date.now() - startedAt;
      assert.equal(applied.ok, true);

      const stored = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM onec_catalog_product_properties`,
      );
      assert.equal(stored.rows[0]?.count, "107900");

      assert.ok(elapsedMs < 600_000, `apply took ${elapsedMs}ms`);
    },
  );
});
