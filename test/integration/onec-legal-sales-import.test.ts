import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runLegalSalesImport } from "../../src/onec-sales/run-import";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { buildSaleJsonBytes, buildSaleRecord, LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";

function env(databaseUrl: string): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: databaseUrl, PGSSLMODE: "disable" };
}

describe("onec legal sales import", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        INSERT INTO onec_v3_legal_entities (guid_client, name_client)
        VALUES ($1::uuid, 'Legal Sales Fixture')
        ON CONFLICT (guid_client) DO NOTHING
      `,
      [LEGAL_A],
    );
    await pool.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        ) VALUES (
          $1::uuid, '2026-08-01'::date, 'Legacy month', 1, 10,
          0, 0, 0, 5, 0, 5, 50,
          'legacy', NOW()
        )
        ON CONFLICT DO NOTHING
      `,
      [LEGAL_A],
    );
    await pool.end();
  });

  after(async () => {
    await closePool();
  });

  it("dry-run does not write and apply is idempotent", async () => {
    const rosterBytes = buildSaleJsonBytes([
      buildSaleRecord({ legalGuid: LEGAL_A, type: "Входные двери", income: 1000 }),
      buildSaleRecord({ legalGuid: LEGAL_B, type: "Unknown legal", income: 1 }),
    ]);

    const dry = await runLegalSalesImport({
      env: env(databaseUrl),
      argv: ["--dry-run", "--sale-file", "/dev/null"],
      saleBytes: rosterBytes,
    });
    assert.equal(dry.status, "SUCCESS", dry.message);
    assert.equal(dry.plan?.insertCount, 1);
    assert.equal(dry.plan?.unknownLegalGuids.length, 1);

    const poolBefore = new Pool({ connectionString: databaseUrl, max: 1 });
    const before = await poolBefore.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_legal_sales_lines WHERE legal_guid = $1::uuid AND product_type = 'Входные двери'`,
      [LEGAL_A],
    );
    await poolBefore.end();
    assert.equal(Number(before.rows[0]?.count ?? 0), 0);

    const applied = await runLegalSalesImport({
      env: env(databaseUrl),
      argv: [
        "--apply",
        "--sale-file",
        "/dev/null",
        "--expected-source-sha256",
        dry.sourceSha256!,
        "--confirm-target-db",
        dry.targetDbFingerprint!,
      ],
      saleBytes: rosterBytes,
    });
    assert.equal(applied.status, "SUCCESS", applied.message);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const august = await pool.query(
      `SELECT 1 FROM onec_v3_legal_sales_lines WHERE legal_guid = $1::uuid AND sale_month = '2026-08-01'::date`,
      [LEGAL_A],
    );
    assert.equal(august.rowCount, 1, "other month row must remain");

    const dry2 = await runLegalSalesImport({
      env: env(databaseUrl),
      argv: ["--dry-run", "--sale-file", "/dev/null"],
      saleBytes: rosterBytes,
    });
    const applied2 = await runLegalSalesImport({
      env: env(databaseUrl),
      argv: [
        "--apply",
        "--sale-file",
        "/dev/null",
        "--expected-source-sha256",
        dry2.sourceSha256!,
        "--confirm-target-db",
        dry2.targetDbFingerprint!,
      ],
      saleBytes: rosterBytes,
    });
    assert.equal(applied2.status, "SUCCESS");
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_legal_sales_lines WHERE legal_guid = $1::uuid AND product_type = 'Входные двери'`,
      [LEGAL_A],
    );
    assert.equal(Number(count.rows[0]?.count ?? 0), 1);
    await pool.end();
  });

  it("rejects invalid file without partial apply", async () => {
    const invalid = buildSaleJsonBytes([
      buildSaleRecord({ legalGuid: LEGAL_A, type: "A", income: 1 }),
      buildSaleRecord({ legalGuid: LEGAL_A, type: "A", income: 2 }),
    ]);
    const parsed = parseLegalSalesJsonBytes(invalid);
    assert.equal(parsed.ok, false);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const before = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_legal_sales_lines WHERE legal_guid = $1::uuid`,
      [LEGAL_A],
    );
    await pool.end();
    const applyAttempt = await runLegalSalesImport({
      env: env(databaseUrl),
      argv: ["--apply", "--sale-file", "/dev/null", "--expected-source-sha256", "f".repeat(64), "--confirm-target-db", "f".repeat(64)],
      saleBytes: invalid,
    });
    assert.equal(applyAttempt.status, "VALIDATION_FAILED");
    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const after = await poolAfter.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_legal_sales_lines WHERE legal_guid = $1::uuid`,
      [LEGAL_A],
    );
    await poolAfter.end();
    assert.equal(after.rows[0]?.count, before.rows[0]?.count);
  });
});
