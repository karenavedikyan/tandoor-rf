import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { getLegalSalesForMonth } from "../../src/clients/v3/legal-sales";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import type { AccessContext } from "../../src/access/types";
import { buildSaleRecord, LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";
import { applyLegalSalesImport } from "../../src/onec-sales/plan-apply";
import { parseLegalSalesJsonBytes } from "../../src/onec-sales/parse-sale-json";
import { buildSaleJsonBytes } from "../helpers/legal-sales-fixtures";

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

describe("v3 legal sales API", { concurrency: false }, () => {
  let databaseUrl = "";
  let adminUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    await prepareDatabase(databaseUrl);
    setIntegrationEnv(databaseUrl);
    await resetPoolForTests();
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-legal-sales@example.test",
      password: "StrongPass123!",
      fullName: "Admin Legal Sales",
      role: "admin",
    });
    adminUserId = admin.id;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO onec_v3_legal_entities (guid_client, name_client)
       VALUES ($1::uuid, 'Legal A'), ($2::uuid, 'Legal B')
       ON CONFLICT DO NOTHING`,
      [LEGAL_A, LEGAL_B],
    );
    await pool.query(
      `
        UPDATE onec_v3_exchange_state
        SET last_bundle_fingerprint = $1, updated_at = NOW()
        WHERE id = 1
      `,
      ["a".repeat(64)],
    );
    const parsed = parseLegalSalesJsonBytes(
      buildSaleJsonBytes([buildSaleRecord({ legalGuid: LEGAL_A, type: "Фурнитура (ручки)", income: 900 })]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyLegalSalesImport(client, parsed.roster);
      await client.query("COMMIT");
    } finally {
      client.release();
      await pool.end();
    }
  });

  after(async () => {
    await closePool();
  });

  it("returns sales for accessible legal and hides foreign legal", async () => {
    const own = await getLegalSalesForMonth(adminContext(adminUserId), LEGAL_A, "2026-09");
    assert.ok(own);
    if (!own || own === "invalid_month") return;
    assert.equal(own.lines.length, 1);
    assert.equal(Number(own.incomeTotal), 900);

    const foreign = await getLegalSalesForMonth(adminContext(adminUserId), LEGAL_B, "2026-09");
    assert.ok(foreign);
    if (!foreign || foreign === "invalid_month") return;
    assert.equal(foreign.lines.length, 0);
  });

  it("exposes authorized HTTP routes", async () => {
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "admin-legal-sales@example.test", password: "StrongPass123!" });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const months = await request(app)
      .get("/api/clients/v3/legal/" + LEGAL_A + "/sales/months")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(months.status, 200);
    assert.ok(months.body.months.includes("2026-09"));
  });
});
