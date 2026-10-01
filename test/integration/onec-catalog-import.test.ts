import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { runCatalogImport } from "../../src/onec-catalog/run-import";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { resetPoolForTests } from "../../src/db/pool";
import {
  buildLargeProductsXml,
  buildMinimalCatalogXmlSet,
  catalogEntriesFromXmlSet,
  manifestFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

describe("onec catalog import integration", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    await resetPoolForTests();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
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
      SET active_version_id = NULL, last_successful_manifest_sha256 = NULL, apply_blocked = FALSE
      WHERE id = 1;
    `);
    await pool.end();
  });

  after(async () => {
    await resetPoolForTests();
  });

  it("dry-run validates minimal catalog and quarantines known bad commercial refs", async () => {
    const entries = catalogEntriesFromXmlSet(buildMinimalCatalogXmlSet());
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    const validated = validateCatalogSet(parsed.data!);
    assert.equal(validated.ok, true);
    assert.ok((validated.data?.quarantine.length ?? 0) >= 2);

    const dryRun = await runCatalogImport({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      localFiles: entries,
      argv: ["--dry-run"],
      skipStabilityCheck: true,
    });
    assert.equal(dryRun.status, "PARTIAL");
    assert.equal(dryRun.coreApplied, false);
    assert.equal(dryRun.commercialReady, false);
    assert.ok((dryRun.quarantineCount ?? 0) >= 2);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const versions = await pool.query("SELECT COUNT(*)::int AS count FROM onec_catalog_versions");
    await pool.end();
    assert.equal(versions.rows[0]?.count, 0);
  });

  it("apply is idempotent for the same manifest", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    const manifestSha = manifestFromXmlSet(xmlSet);
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    const validated = validateCatalogSet(parsed.data!);
    assert.equal(validated.ok, true);

    const first = await runCatalogImport({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      localFiles: entries,
      argv: ["--apply", `--expected-manifest-sha256=${manifestSha}`],
      skipStabilityCheck: true,
    });
    assert.equal(first.status, "PARTIAL");
    assert.equal(first.coreApplied, true);
    assert.equal(first.commercialReady, false);

    const second = await runCatalogImport({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      localFiles: entries,
      argv: ["--apply", `--expected-manifest-sha256=${manifestSha}`],
      skipStabilityCheck: true,
    });
    assert.equal(second.status, "SKIPPED_UNCHANGED");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const active = await pool.query<{ product_count: number }>(
      `SELECT product_count FROM onec_catalog_versions WHERE is_active = TRUE`,
    );
    const clients = await pool.query<{ count: string }>("SELECT COUNT(*) FROM onec_clients");
    await pool.end();
    assert.equal(active.rows[0]?.product_count, 2);
    assert.ok(Number(clients.rows[0]?.count) >= 0);
  });

  it("blocks apply when known product codes disappear", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    const validated = validateCatalogSet(parsed.data!);
    await applyCatalogImport(databaseUrl, validated.data!);

    const shrunk = { ...xmlSet };
    shrunk["catalog/products/data.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/p1.jpg</Картинка></Картинки>
    <Свойства>
      <Свойство Код="type" Название="Тип товара" Значение="Складская"/>
    </Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
</Товары>`;
    const shrunkEntries = catalogEntriesFromXmlSet(shrunk);
    const shrunkParsed = await parseCatalogSet(
      shrunkEntries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    const shrunkValidated = validateCatalogSet(shrunkParsed.data!);
    const blocked = await applyCatalogImport(databaseUrl, shrunkValidated.data!);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.ok(blocked.code === "PRODUCT_CODE_LOSS" || blocked.code === "RECORD_COUNT_DECREASED");
    }
  });

  it("parses a large synthetic products file within documented limits", { timeout: 180_000 }, async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = buildLargeProductsXml(31 * 1024 * 1024);
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const products = entries.find((file) => file.relativePath === "catalog/products/data.xml");
    assert.ok(products);
    assert.ok(products.byteSize >= 31 * 1024 * 1024);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    assert.ok((parsed.data?.products.length ?? 0) > 1000);
  });
});
