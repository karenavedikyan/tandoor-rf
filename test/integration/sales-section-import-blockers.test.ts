import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import type { AccessContext } from "../../src/access/types";
import {
  loadSalesSectionOverview,
  listSalesSectionMonths,
} from "../../src/clients/v3/sales-section";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B, buildSaleJsonBytes, buildSaleRecord } from "../helpers/legal-sales-fixtures";
import { buildSaleItemRecord } from "../helpers/sales-bundle-fixtures";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { parseLegalSaleItemsJsonBytes } from "../../src/onec-sales/parse-sale-items-json";
import { parseLegalReturnsJsonBytes } from "../../src/onec-sales/parse-returne-json";
import { parseLegalReturnItemsJsonBytes } from "../../src/onec-sales/parse-returne-items-json";
import { applyLegalSalesImport } from "../../src/onec-sales/plan-apply";
import { applySaleItemsRoster, applySalesBundle } from "../../src/onec-sales/plan-apply-bundle";
import {
  buildAlignedSalesBundleBuffers,
  buildMisalignedSalesItemsBuffer,
} from "../helpers/sales-bundle-fixtures";

const UNKNOWN_LEGAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function adminContext(): AccessContext {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    role: "admin",
    status: "active",
    employeeId: null,
    employeeLinkConflict: false,
    hasEmployeeLink: false,
    hasScopedClientAccess: false,
    fullClientBase: true,
    explicitlyDeniedAll: false,
  };
}

describe("sales section import blockers", { concurrency: false }, () => {
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
         VALUES ($1::uuid, 'Legal A', '{}'::jsonb, '{}'::jsonb, 'test'),
                ($2::uuid, 'Legal B', '{}'::jsonb, '{}'::jsonb, 'test')
         ON CONFLICT (guid_client) DO NOTHING`,
        [LEGAL_A, LEGAL_B],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool?.end();
    await closePool();
  });

  it("keeps August aggregate overview after September items import", async () => {
    const client = await pool.connect();
    try {
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

    const months = await listSalesSectionMonths(adminContext(), {});
    assert.ok(months.includes("2026-08"));
    assert.ok(months.includes("2026-09"));

    const augOverview = await loadSalesSectionOverview(adminContext(), "2026-08", {});
    assert.notEqual(augOverview, "invalid_month");
    if (augOverview === "invalid_month") return;
    assert.equal(augOverview.salesSource, "aggregate");
    assert.ok(augOverview.categories.length > 0);
    assert.equal(Number(augOverview.categories[0]?.income), 200);
  });

  it("replaces same-month aggregate and drops removed legal entity rows", async () => {
    const client = await pool.connect();
    try {
      const both = parseLegalSalesJsonBytes(
        buildSaleJsonBytes([
          buildSaleRecord({
            legalGuid: LEGAL_A,
            type: "Входные двери",
            month: "2026-07-01T00:00:00",
            income: 10,
            quantity: 1,
          }),
          buildSaleRecord({
            legalGuid: LEGAL_B,
            type: "Входные двери",
            month: "2026-07-01T00:00:00",
            income: 20,
            quantity: 2,
          }),
        ]),
      );
      assert.equal(both.ok, true);
      if (!both.ok) return;
      await applyLegalSalesImport(client, both.roster);

      const onlyA = parseLegalSalesJsonBytes(
        buildSaleJsonBytes([
          buildSaleRecord({
            legalGuid: LEGAL_A,
            type: "Входные двери",
            month: "2026-07-01T00:00:00",
            income: 30,
            quantity: 3,
          }),
        ]),
      );
      assert.equal(onlyA.ok, true);
      if (!onlyA.ok) return;
      await applyLegalSalesImport(client, onlyA.roster);
    } finally {
      client.release();
    }

    const rows = await pool.query<{ legal_guid: string }>(
      `SELECT lower(legal_guid::text) AS legal_guid
       FROM onec_v3_legal_sales_lines
       WHERE sale_month = '2026-07-01'::date`,
    );
    assert.deepEqual(
      rows.rows.map((r) => r.legal_guid).sort(),
      [LEGAL_A.toLowerCase()],
    );
  });

  it("surfaces quarantined rows to admin overview as partial", async () => {
    const client = await pool.connect();
    try {
      const items = parseLegalSaleItemsJsonBytes(
        buildSaleJsonBytes([
          buildSaleItemRecord({
            legalGuid: UNKNOWN_LEGAL,
            month: "2026-10-01T00:00:00",
            income: 50,
            quantity: 1,
          }),
        ]),
      );
      assert.equal(items.ok, true);
      if (!items.ok) return;
      const applied = await applySaleItemsRoster(client, items.roster, new Set([LEGAL_A.toLowerCase()]));
      assert.equal(applied.quarantined, 1);
    } finally {
      client.release();
    }

    const overview = await loadSalesSectionOverview(adminContext(), "2026-10", {});
    assert.notEqual(overview, "invalid_month");
    if (overview === "invalid_month") return;
    assert.equal(overview.dataState, "partial");
    assert.equal(overview.importMeta.globalQuarantinedItemRows, 1);
    assert.ok(overview.importMeta.coverageNote.includes("Вне каталога"));
  });

  it("blocks bundle apply when parity mismatches", async () => {
    const client = await pool.connect();
    try {
      const aligned = buildAlignedSalesBundleBuffers();
      const misalignedItems = buildMisalignedSalesItemsBuffer();
      const agg = parseLegalSalesJsonBytes(aligned.saleAggregate);
      const items = parseLegalSaleItemsJsonBytes(misalignedItems);
      const retAgg = parseLegalReturnsJsonBytes(aligned.returnsAggregate);
      const retItems = parseLegalReturnItemsJsonBytes(aligned.returnItems);
      assert.equal(agg.ok && items.ok && retAgg.ok && retItems.ok, true);
      if (!agg.ok || !items.ok || !retAgg.ok || !retItems.ok) return;

      const before = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines`,
      );
      await assert.rejects(
        () =>
          applySalesBundle(
            client,
            {
              saleAggregate: agg.roster,
              saleItems: items.roster,
              returnsAggregate: retAgg.roster,
              returnItems: retItems.roster,
            },
            new Set([LEGAL_A.toLowerCase(), LEGAL_B.toLowerCase()]),
          ),
        /BUNDLE_PARITY_FAILED/,
      );
      const after = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM onec_v3_legal_sale_item_lines`,
      );
      assert.equal(before.rows[0]?.n, after.rows[0]?.n);
    } finally {
      client.release();
    }
  });
});
