import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { resolveMonthSalesSource } from "../../src/clients/v3/sales-section";
import { loadSalesImportSnapshotState } from "../../src/onec-sales/import-snapshot";
import { LEGAL_A } from "../helpers/legal-sales-fixtures";
import { buildSaleItemRecord } from "../helpers/sales-bundle-fixtures";
import { buildSaleJsonBytes, buildSaleRecord } from "../helpers/legal-sales-fixtures";
import { parseLegalSaleItemsJsonBytes } from "../../src/onec-sales/parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { applySaleItemsRoster } from "../../src/onec-sales/plan-apply-bundle";
import { applyLegalSalesImport } from "../../src/onec-sales/plan-apply";

describe("sales section month source resolution", () => {
  let pool: Pool;

  before(async () => {
    const db = getIntegrationDatabaseUrl();
    setIntegrationEnv(db, "http://127.0.0.1:0");
    await resetPoolForTests();
    await prepareDatabase(db);
    pool = new Pool({ connectionString: db });
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO onec_v3_legal_entities (guid_client, name_client, type_category, other_fields, last_source_sha256)
         VALUES ($1::uuid, 'QA Legal', '{}'::jsonb, '{}'::jsonb, 'test')
         ON CONFLICT (guid_client) DO NOTHING`,
        [LEGAL_A],
      );
      const aug = parseLegalSalesJsonBytes(
        buildSaleJsonBytes([
          buildSaleRecord({
            legalGuid: LEGAL_A,
            type: "Входные двери",
            month: "2026-08-01T00:00:00",
            income: 200,
            quantity: 2,
          }),
        ]),
      );
      assert.equal(aug.ok, true);
      if (!aug.ok) return;
      await applyLegalSalesImport(client, aug.roster);
      const sepItems = parseLegalSaleItemsJsonBytes(
        buildSaleJsonBytes([
          buildSaleItemRecord({
            legalGuid: LEGAL_A,
            month: "2026-09-01T00:00:00",
            income: 100,
            quantity: 1,
          }),
        ]),
      );
      assert.equal(sepItems.ok, true);
      if (!sepItems.ok) return;
      await applySaleItemsRoster(client, sepItems.roster, new Set([LEGAL_A.toLowerCase()]));
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool?.end();
    await closePool();
  });

  it("uses aggregate for August and items for September", async () => {
    const snapshot = await loadSalesImportSnapshotState();
    const aug = await resolveMonthSalesSource(snapshot, "2026-08-01");
    const sep = await resolveMonthSalesSource(snapshot, "2026-09-01");
    assert.equal(aug, "aggregate");
    assert.equal(sep, "items");
  });
});
