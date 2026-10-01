import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { runCatalogImport } from "../../src/onec-catalog/run-import";
import { resetPoolForTests } from "../../src/db/pool";
import {
  buildMinimalCatalogXmlSet,
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
  catalogEntriesFromXmlSet,
  manifestFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

describe("onec catalog distribution profile integration", { concurrency: false }, () => {
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

  it("dry-run succeeds without commercial files and reports missing group references", async () => {
    const xmlSet = buildMinimalDistributionXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
      'Группа="g1"',
      'Группа="ghost-group"',
    );
    const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
    const dryRun = await runCatalogImport({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      localFiles: entries,
      argv: ["--dry-run", "--profile=distribution"],
      skipStabilityCheck: true,
    });
    assert.equal(dryRun.status, "SUCCESS");
    assert.equal(dryRun.profile, "distribution");
    assert.equal(dryRun.commercialStatus, "not_requested");
    assert.equal(dryRun.classificationIncomplete, true);
    assert.equal(dryRun.classificationWarnings?.[0]?.code, "MISSING_GROUP_REFERENCE");
    assert.equal(dryRun.coreApplied, false);
    assert.equal(dryRun.distributionReady, false);
    assert.equal(dryRun.quarantineCount, 0);
  });

  it("apply imports products with missing group and preserves group_code in DB reads", async () => {
    const xmlSet = buildMinimalDistributionXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
      'Группа="g1"',
      'Группа="ghost-group"',
    );
    const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
    const manifestSha = manifestFromXmlSet(
      { ...buildMinimalCatalogXmlSet(), ...xmlSet },
      "distribution",
    );

    const applied = await runCatalogImport({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      localFiles: entries,
      argv: ["--apply", `--expected-manifest-sha256=${manifestSha}`, "--profile=distribution"],
      skipStabilityCheck: true,
    });
    assert.equal(applied.status, "SUCCESS");
    assert.equal(applied.distributionReady, true);
    assert.equal(applied.commercialReady, false);
    assert.equal(applied.classificationIncomplete, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const productRow = await pool.query<{ code: string; group_code: string | null; name: string }>(
      `SELECT code, group_code, name FROM onec_catalog_products WHERE code = 'p1'`,
    );
    assert.equal(productRow.rows[0]?.group_code, "ghost-group");
    assert.equal(productRow.rows[0]?.name, "Product one");

    const visibleProducts = await pool.query<{ code: string; group_code: string | null; group_found: boolean | null }>(
      `
        SELECT p.code, p.group_code, (g.code IS NOT NULL) AS group_found
        FROM onec_catalog_products p
        LEFT JOIN onec_catalog_groups g
          ON g.version_id = p.version_id AND g.code = p.group_code
        WHERE p.code = 'p1'
      `,
    );
    assert.equal(visibleProducts.rows.length, 1);
    assert.equal(visibleProducts.rows[0]?.group_found, false);

    const stagingCounts = await pool.query<{ prices: string; stock: string }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM onec_catalog_prices_staging) AS prices,
          (SELECT COUNT(*)::text FROM onec_catalog_stock_staging) AS stock
      `,
    );
    assert.equal(stagingCounts.rows[0]?.prices, "0");
    assert.equal(stagingCounts.rows[0]?.stock, "0");

    const version = await pool.query<{ import_profile: string; distribution_ready: boolean }>(
      `SELECT import_profile, distribution_ready FROM onec_catalog_versions WHERE is_active = TRUE`,
    );
    assert.equal(version.rows[0]?.import_profile, "distribution");
    assert.equal(version.rows[0]?.distribution_ready, true);
    await pool.end();
  });

  it("full profile still blocks missing group references", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
      'Группа="g1"',
      'Группа="ghost-group"',
    );
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const dryRun = await runCatalogImport({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      localFiles: entries,
      argv: ["--dry-run"],
      skipStabilityCheck: true,
    });
    assert.equal(dryRun.status, "VALIDATION_FAILED");
    assert.ok(dryRun.errors?.some((issue) => issue.code === "MISSING_GROUP"));
  });

  it("distribution and full manifests for overlapping files are not interchangeable", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    const distributionSha = manifestFromXmlSet(xmlSet, "distribution");
    const fullSha = manifestFromXmlSet(xmlSet, "full");
    assert.notEqual(distributionSha, fullSha);

    const entries = catalogDistributionEntriesFromXmlSet(buildMinimalDistributionXmlSet());
    const wrongProfileApply = await runCatalogImport({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      localFiles: entries,
      argv: ["--apply", `--expected-manifest-sha256=${fullSha}`, "--profile=distribution"],
      skipStabilityCheck: true,
    });
    assert.equal(wrongProfileApply.status, "HASH_MISMATCH");
  });
});
