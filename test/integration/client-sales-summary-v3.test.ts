import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import * as dbPool from "../../src/db/pool";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import type { AccessContext } from "../../src/access/types";
import {
  batchClientSalesListSummaries,
  buildClientSalesTabPath,
  CLIENT_SALES_BATCH_MAX_IDS,
  CLIENT_SALES_BATCH_QUERY_BUDGET,
  loadClientSalesCardSummary,
  parseClientSalesBatchTargets,
  parseClientSalesMonthStrict,
} from "../../src/clients/v3/client-sales-summary";
import { denyClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
import request from "supertest";

const ORIGIN = "http://127.0.0.1:3000";

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
let app: Awaited<ReturnType<typeof import("../../src/server").createApp>>;
let adminCookie = "";

before(async () => {
  url = getIntegrationDatabaseUrl();
  setIntegrationEnv(url, ORIGIN);
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

  const { createApp } = await import("../../src/server");
  app = createApp();
  const loginRes = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email: "admin-client-sales-summary@example.test", password: "StrongPass123!" });
  assert.equal(loginRes.status, 200);
  adminCookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
});

after(async () => {
  await closePool();
});

describe("client sales summary v3", () => {
  it("parses strict month only as YYYY-MM", () => {
    assert.equal(parseClientSalesMonthStrict("2026-09").ok, true);
    assert.equal(parseClientSalesMonthStrict("2026-09-01").ok, false);
  });

  it("holding with missing legal line data is incomplete without partial totals", async () => {
    const summary = await loadClientSalesCardSummary(adminCtx, "holding", HOLDING, "2026-09", {});
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary!.dataState, "incomplete");
    assert.equal(summary!.incomeTotal, null);
    assert.equal(summary!.quantityTotal, null);
    assert.equal(summary!.legalEntitiesWithSalesCount, null);
    const rowB = summary!.breakdown.find((r) => r.legalGuid === LEGAL_B);
    assert.equal(rowB?.rowStatus, "unavailable");
    assert.equal(
      summary!.breakdown.some((r) => r.sharePercent != null && r.legalGuid === LEGAL_A),
      false,
    );
  });

  it("legal explicit zero remains loaded with zero row", async () => {
    const pool = new Pool({ connectionString: url });
    await pool.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        ) VALUES ($1::uuid, '2026-09-01'::date, 'Doors', 0, 0, 0,0,0,0,0,0,0, $2, NOW())
      `,
      [LEGAL_B, "a".repeat(64)],
    );
    await pool.end();
    const summary = await loadClientSalesCardSummary(adminCtx, "holding", HOLDING, "2026-09", {});
    assert.equal(summary && typeof summary === "object" ? summary.dataState : null, "loaded");
    const rowB = summary && typeof summary === "object"
      ? summary.breakdown.find((r) => r.legalGuid === LEGAL_B)
      : null;
    assert.equal(rowB?.rowStatus, "known_zero");
  });

  it("does not expose hidden holding totals in API shape", async () => {
    const summary = await loadClientSalesCardSummary(adminCtx, "holding", HOLDING, "2026-09", {});
    assert.ok(summary && typeof summary === "object");
    assert.equal("holdingLegalTotalCount" in summary!, false);
    assert.equal("accessibleLegalCount" in summary!, false);
  });

  it("builds sales tab path with legal guid", () => {
    const path = buildClientSalesTabPath(LEGAL_A, "2026-09", "?v3mode=1");
    assert.match(path, new RegExp(`/clients/${LEGAL_A}`));
    assert.match(path, /v3Entity=legal/);
    assert.match(path, /cardTab=sales/);
    assert.match(path, /v3salesMonth=2026-09/);
  });

  it("rejects batch over 100 ids", async () => {
    const targets = Array.from({ length: CLIENT_SALES_BATCH_MAX_IDS + 1 }, (_, i) => ({
      kind: "legal" as const,
      guid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const r = await batchClientSalesListSummaries(adminCtx, "2026-09", targets, {});
    assert.equal(r, "batch_too_large");
  });

  it("batch POST on readChain rejects invalid targets and accepts valid", async () => {
    const bad = await request(app)
      .post("/api/clients/v3/client-sales/batch")
      .set("Cookie", adminCookie)
      .send({ month: "2026-09", targets: "not-an-array" });
    assert.equal(bad.status, 400);
    const parsed = parseClientSalesBatchTargets([{ kind: "holding", guid: HOLDING }]);
    assert.equal(parsed.ok, true);
    const ok = await request(app)
      .post("/api/clients/v3/client-sales/batch")
      .set("Cookie", adminCookie)
      .send({
        month: "2026-09",
        targets: [{ kind: "holding", guid: HOLDING }],
      });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.summaries[`holding:${HOLDING.toLowerCase()}`]);
    const cache = String(ok.headers["cache-control"] || "");
    assert.match(cache, /no-store/i);
  });

  it("batch POST rejects non-array targets without silent empty accept", async () => {
    const missing = await request(app)
      .post("/api/clients/v3/client-sales/batch")
      .set("Cookie", adminCookie)
      .send({ month: "2026-09" });
    assert.equal(missing.status, 400);
  });

  it("withheld legal returns null without leaking", async () => {
    const outsider = managerContext("00000000-0000-4000-8000-000000000099", "99999999-9999-4999-8999-999999999999");
    const summary = await loadClientSalesCardSummary(outsider, "legal", LEGAL_A, "2026-09", {});
    assert.equal(summary, null);
  });

  it("rejects invalid UUID in batch targets", () => {
    const r = parseClientSalesBatchTargets([{ kind: "legal", guid: "------------------------------------" }]);
    assert.equal(r.ok, false);
  });

  it("rejects malformed managerGuid on client-sales endpoints", async () => {
    const months = await request(app)
      .get("/api/clients/v3/client-sales/months?managerGuid=not-a-uuid")
      .set("Cookie", adminCookie);
    assert.equal(months.status, 400);
    const batch = await request(app)
      .post("/api/clients/v3/client-sales/batch?managerGuid=not-a-uuid")
      .set("Cookie", adminCookie)
      .send({ month: "2026-09", targets: [{ kind: "holding", guid: HOLDING }] });
    assert.equal(batch.status, 400);
  });

  it("manager territory narrows holding breakdown without broadening full base", async () => {
    const pool = new Pool({ connectionString: url });
    const mgrA = "99999999-9999-4999-8999-111111111111";
    const mgrB = "99999999-9999-4999-8999-222222222222";
    await pool.query(
      `UPDATE onec_v3_legal_entities SET managers = jsonb_build_object('guidManager', $1::text) WHERE guid_client = $2::uuid`,
      [mgrA, LEGAL_A],
    );
    await pool.query(
      `UPDATE onec_v3_legal_entities SET managers = jsonb_build_object('guidManager', $1::text) WHERE guid_client = $2::uuid`,
      [mgrB, LEGAL_B],
    );
    await pool.end();
    const scoped = await loadClientSalesCardSummary(adminCtx, "holding", HOLDING, "2026-09", {
      managerGuid: mgrA,
    });
    assert.ok(scoped && typeof scoped === "object");
    assert.equal(scoped!.breakdown.length, 1);
    assert.equal(scoped!.breakdown[0]!.legalGuid, LEGAL_A);
    const full = await loadClientSalesCardSummary(adminCtx, "holding", HOLDING, "2026-09", {});
    assert.ok(full && typeof full === "object");
    assert.equal(full!.breakdown.length, 2);
  });

  it("batch authorization uses bounded query count", async () => {
    const originalQuery = dbPool.query;
    let queryCount = 0;
    (dbPool as { query: typeof dbPool.query }).query = async (text, params) => {
      queryCount += 1;
      return originalQuery(text, params);
    };
    try {
      const one = [{ kind: "holding" as const, guid: HOLDING }];
      queryCount = 0;
      await batchClientSalesListSummaries(adminCtx, "2026-09", one, {});
      const countOne = queryCount;
      const many = Array.from({ length: 100 }, (_, i) => ({
        kind: "legal" as const,
        guid:
          i === 0
            ? LEGAL_A
            : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      }));
      queryCount = 0;
      await batchClientSalesListSummaries(adminCtx, "2026-09", many, {});
      const countMany = queryCount;
      assert.ok(countOne <= CLIENT_SALES_BATCH_QUERY_BUDGET);
      assert.ok(countMany <= CLIENT_SALES_BATCH_QUERY_BUDGET);
      assert.ok(countMany <= countOne + 2);
    } finally {
      (dbPool as { query: typeof dbPool.query }).query = originalQuery;
    }
  });

  it("explicit denial blocks card without hidden sibling disclosure fields", async () => {
    const pool = new Pool({ connectionString: url });
    const deniedUser = await createTestUser({
      databaseUrl: url,
      email: "denied-sales@example.test",
      password: "StrongPass123!",
      fullName: "Denied Sales",
      role: "director",
    });
    await denyClientAccess({
      databaseUrl: url,
      userId: deniedUser.id,
      scopeType: "client",
      objectId: LEGAL_A,
      deniedByUserId: adminCtx.userId,
    });
    await pool.end();
    const deniedCtx = adminContext(deniedUser.id);
    deniedCtx.role = "director";
    const summary = await loadClientSalesCardSummary(deniedCtx, "holding", HOLDING, "2026-09", {});
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary!.breakdown.some((r) => r.legalGuid === LEGAL_A), false);
    assert.equal("holdingLegalTotalCount" in summary!, false);
  });

  it("GET batch validates targets and returns the same scoped data as card", async () => {
    const response = await request(app)
      .get("/api/clients/v3/client-sales/batch")
      .query({ month: "2026-09", target: `holding:${HOLDING}`,
        managerGuid: "99999999-9999-4999-8999-111111111111" })
      .set("Cookie", adminCookie);
    assert.equal(response.status, 200);
    assert.match(JSON.stringify(response.body), /100.50/);
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(LEGAL_B));
    const bad = await request(app).get("/api/clients/v3/client-sales/batch")
      .query({ month: "2026-09", target: "legal:------------------------------------" })
      .set("Cookie", adminCookie);
    assert.equal(bad.status, 400);
  });

  it("real employee preview permits scoped GET batch while POST remains blocked", async () => {
    const manager = await createTestUser({
      databaseUrl: url, email: "sales-preview-manager@example.test",
      password: "StrongPass123!", fullName: "Sales Preview Manager", role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl: url, userId: manager.id,
      employeeId: "99999999-9999-4999-8999-111111111111",
      confirmedByUserId: adminCtx.userId,
    });
    const headers = { Cookie: adminCookie, Origin: ORIGIN };
    const start = await request(app).post("/api/admin/access/preview/start")
      .set(headers).send({ userId: manager.id });
    assert.equal(start.status, 200);
    try {
      const batch = await request(app).get("/api/clients/v3/client-sales/batch")
        .query({ month: "2026-09", target: `holding:${HOLDING}` }).set(headers);
      assert.equal(batch.status, 200);
      assert.match(JSON.stringify(batch.body), /100.50/);
      assert.doesNotMatch(JSON.stringify(batch.body), new RegExp(LEGAL_B));
      const write = await request(app).post("/api/clients/v3/client-sales/batch")
        .set(headers).send({ month: "2026-09", targets: [{ kind: "holding", guid: HOLDING }] });
      assert.equal(write.status, 403);
    } finally {
      const stop = await request(app).post("/api/admin/access/preview/stop").set(headers).send({});
      assert.equal(stop.status, 200);
    }
  });
});
