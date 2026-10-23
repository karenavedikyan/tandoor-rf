import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import type { AccessContext } from "../../src/access/types";
import {
  listSalesSectionClientRows,
  loadSalesSectionOverview,
} from "../../src/clients/v3/sales-section";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { buildAlignedSalesBundleBuffers } from "../helpers/sales-bundle-fixtures";
import { parseLegalReturnItemsJsonBytes } from "../../src/onec-sales/parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "../../src/onec-sales/parse-returne-json";
import { parseLegalSaleItemsJsonBytes } from "../../src/onec-sales/parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import {
  applyReturnItemsRoster,
  applyReturnsRoster,
} from "../../src/onec-sales/plan-apply-bundle";

const CAT = "Входные двери";

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

describe("sales section returns finance availability", { concurrency: false }, () => {
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
      const bundle = buildAlignedSalesBundleBuffers();
      const retAgg = parseLegalReturnsJsonBytes(bundle.returnsAggregate);
      const retItems = parseLegalReturnItemsJsonBytes(bundle.returnItems);
      assert.equal(retAgg.ok && retItems.ok, true);
      if (!retAgg.ok || !retItems.ok) return;
      const known = new Set([LEGAL_A.toLowerCase(), LEGAL_B.toLowerCase()]);
      await applyReturnsRoster(client, retAgg.roster, known);
      await applyReturnItemsRoster(client, retItems.roster, known);
      await client.query(`DELETE FROM onec_v3_legal_return_item_lines`);
      await client.query(`DELETE FROM onec_v3_legal_return_item_import_state`);
      await client.query(`DELETE FROM onec_v3_legal_sales_month_activation WHERE dataset = 'return_items'`);
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool?.end();
    await closePool();
  });

  it("overview returns categories omit invented finance metrics", async () => {
    const overview = await loadSalesSectionOverview(adminContext(), "2026-09", {});
    assert.notEqual(overview, "invalid_month");
    if (overview === "invalid_month") return;
    assert.equal(overview.returnsSource, "aggregate");
    assert.equal(overview.returnsFinanceAvailability.grossProfit, false);
    assert.ok(overview.returnsCategories.length > 0);
    const row = overview.returnsCategories[0];
    assert.equal(row.grossProfit, undefined);
    assert.equal(row.manualDiscount, undefined);
    assert.equal(row.profitabilityPercent, undefined);
    assert.ok(Number(row.quantity) < 0 || Number(row.income) < 0);
    assert.equal(overview.returnsMacroSummaries[0]?.grossProfit ?? null, null);
  });

  it("aggregate-only returns client rows do not query sales finance columns", async () => {
    const clients = await listSalesSectionClientRows(
      adminContext(),
      {},
      "2026-09",
      CAT,
      "",
      "returns",
    );
    assert.notEqual(clients, "invalid_month");
    if (clients === "invalid_month") return;
    assert.ok(clients.length > 0);
    const row = clients[0];
    assert.equal(row.grossProfit, undefined);
    assert.equal(row.costPrice, undefined);
    assert.equal(row.manualDiscount, undefined);
    assert.ok(row.income.includes("-") || Number(row.income) < 0);
  });
});
