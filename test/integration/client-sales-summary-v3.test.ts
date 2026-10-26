import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import type { AccessContext } from "../../src/access/types";
import {
  batchClientSalesListSummaries,
  CLIENT_SALES_BATCH_MAX_IDS,
  loadClientSalesCardSummary,
} from "../../src/clients/v3/client-sales-summary";

function adminContext(userId: string): AccessContext {
  return {
    userId,
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

function managerContext(userId: string, employeeId: string): AccessContext {
  return {
    userId,
    role: "manager",
    status: "active",
    employeeId,
    employeeLinkConflict: false,
    hasEmployeeLink: true,
    hasScopedClientAccess: true,
    fullClientBase: false,
    explicitlyDeniedAll: false,
  };
}

const LEGAL_A = "11111111-1111-4111-8111-111111111101";
const LEGAL_B = "22222222-2222-4222-8222-222222222222";
const HOLDING = "33333333-3333-4333-8333-333333333333";

let url: string;
let adminCtx: AccessContext;

before(async () => {
  url = getIntegrationDatabaseUrl();
  setIntegrationEnv(url);
  await resetPoolForTests();
  await prepareDatabase(url);
  const admin = await createTestUser({
    databaseUrl: url,
    email: "admin-client-sales-summary@example.test",
    password: "StrongPass123!",
    fullName: "Admin Client Sales",
    role: "admin",
  });
  adminCtx = adminContext(admin.id);
  const pool = new Pool({ connectionString: url });
  await pool.query(
    `UPDATE onec_v3_exchange_state SET last_bundle_fingerprint = $1, updated_at = NOW() WHERE id = 1`,
    ["b".repeat(64)],
  );
  await pool.query(
    `
      INSERT INTO onec_v3_holdings (guid_holding, name_holding, type_category, managers, last_source_sha256)
      VALUES ($1::uuid, 'H', '{}'::jsonb, '{}'::jsonb, 't')
      ON CONFLICT DO NOTHING
    `,
    [HOLDING],
  );
  await pool.query(
    `
      INSERT INTO onec_v3_legal_entities (guid_client, name_client, inn, guid_holding, type_category, managers, other_fields, last_source_sha256)
      VALUES
        ($1::uuid, 'Legal A', '7700000001', $3::uuid, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 't'),
        ($2::uuid, 'Legal B', '7700000002', $3::uuid, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 't')
      ON CONFLICT DO NOTHING
    `,
    [LEGAL_A, LEGAL_B, HOLDING],
  );
  await pool.query(
    `
      INSERT INTO onec_v3_legal_sales_import_state (id, source_sha256, row_count, imported_at)
      VALUES (1, $1, 1, NOW())
      ON CONFLICT (id) DO UPDATE SET source_sha256 = EXCLUDED.source_sha256, row_count = EXCLUDED.row_count
    `,
    ["a".repeat(64)],
  );
  await pool.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = '2026-09-01'::date`);
  await pool.query(
    `
      INSERT INTO onec_v3_legal_sales_lines (
        legal_guid, sale_month, product_type, quantity, income,
        manual_discount, automatic_discount, total_discount,
        cost_price, additional_expenses, gross_profit, profitability,
        source_sha256, imported_at
      ) VALUES ($1::uuid, '2026-09-01'::date, 'Doors', 2, 100.50, 0,0,0,0,0,0,0, $2, NOW())
    `,
    [LEGAL_A, "a".repeat(64)],
  );
  await pool.end();
});

after(async () => {
  await closePool();
});

describe("client sales summary v3", () => {
  it("loads holding card summary with accessible legal breakdown", async () => {
    const summary = await loadClientSalesCardSummary(adminCtx, "holding", HOLDING, "2026-09", {});
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary!.dataState, "loaded");
    assert.equal(Number(summary!.incomeTotal), 100.5);
    assert.equal(summary!.legalEntitiesWithSalesCount, 1);
    assert.equal(summary!.breakdown.length, 2);
    const rowA = summary!.breakdown.find((r) => r.legalGuid === LEGAL_A);
    assert.ok(rowA);
    assert.equal(rowA!.rowStatus, "has_sales");
  });

  it("rejects batch over 100 ids", async () => {
    const targets = Array.from({ length: CLIENT_SALES_BATCH_MAX_IDS + 1 }, (_, i) => ({
      kind: "legal" as const,
      guid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const r = await batchClientSalesListSummaries(adminCtx, "2026-09", targets, {});
    assert.equal(r, "batch_too_large");
  });

  it("withheld legal returns null without leaking", async () => {
    const outsider = managerContext("00000000-0000-4000-8000-000000000099", "99999999-9999-4999-8999-999999999999");
    const summary = await loadClientSalesCardSummary(outsider, "legal", LEGAL_A, "2026-09", {});
    assert.equal(summary, null);
  });
});
