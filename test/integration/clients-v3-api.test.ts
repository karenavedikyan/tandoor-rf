import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const HOLDING = "a1000000-0000-4000-8000-000000000001";
const LEGAL = "b2000000-0000-4000-8000-000000000001";
const RETAIL = "c3000000-0000-4000-8000-000000000001";
const ROP = "55555555-5555-4555-8555-555555555555";
const TYPE_A = "t1";
const CAT_A = "c1";
const TYPE_B = "t2";
const CAT_B = "c2";
const LEGAL_UNASSIGNED = "b2000000-0000-4000-8000-000000000003";

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email: email.trim().toLowerCase(), password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("clients v3 API", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  async function seedV3(): Promise<void> {
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(ROP, {
        name_manager: "ROP One",
        post: "Руководитель отдела продаж",
      }),
    ]);
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    const applied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes: loadFixture("all_holding.json"),
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(applied.status, "SUCCESS");
  }

  it("manager sees scoped v3 list; foreign detail returns 404", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const admin = await createTestUser({
      databaseUrl,
      email: "admin-v3-api@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin V3",
      role: "admin",
    });
    const managerEmail = "manager-v3-api@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager V3",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: admin.id,
    });

    const cookie = await login(managerEmail);
    const app = await loadApp();
    const options = await request(app)
      .get("/api/clients/v3/options?entity=legal")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(options.status, 200);
    assert.ok(Array.isArray(options.body.managers));
    const mgrOpt = options.body.managers.find(
      (m: { guid: string }) => m.guid === M1.toLowerCase(),
    );
    assert.ok(mgrOpt);
    assert.equal(mgrOpt.name, "Manager One");
    assert.ok(mgrOpt.count >= 1);
    const typeOpt = options.body.types.find((t: { guid: string }) => t.guid === TYPE_A);
    assert.ok(typeOpt);
    assert.equal(typeOpt.name, "Type A");
    const catOpt = options.body.categories.find((c: { guid: string }) => c.guid === CAT_A);
    assert.ok(catOpt);
    assert.equal(catOpt.name, "Cat A");
    const unassigned = await request(app)
      .get("/api/clients/v3/unassigned-summary")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(unassigned.status, 200);
    assert.ok(typeof unassigned.body.missingManager?.total === "number");
    const list = await request(app)
      .get("/api/clients/v3/list?entity=legal&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(list.status, 200);
    assert.ok(list.body.total >= 1);

    const detailOk = await request(app)
      .get(`/api/clients/v3/detail?entity=legal&guid=${LEGAL}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(detailOk.status, 200);

    const composition = await request(app)
      .get(`/api/clients/v3/holdings/${HOLDING}/composition`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(composition.status, 200);
    assert.ok(Array.isArray(composition.body.legalEntities));

    const manager2Email = "manager2-v3-api@example.com";
    const manager2 = await createTestUser({
      databaseUrl,
      email: manager2Email,
      password: TEST_PASSWORD,
      fullName: "Manager Two",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager2.id,
      employeeId: M2,
      confirmedByUserId: admin.id,
    });
    const cookie2 = await login(manager2Email);
    const withheld = await request(app)
      .get(`/api/clients/v3/detail?entity=legal&guid=${LEGAL}`)
      .set({ Origin: ORIGIN, Cookie: cookie2 });
    assert.equal(withheld.status, 404);
  });

  it("returns scoped v3 filter options and missingManager list filter", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const adminEmail = "admin-v3-filters@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Filters",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();

    const options = await request(app)
      .get("/api/clients/v3/options?entity=legal")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(options.status, 200);
    assert.ok(options.body.types.some((t: { guid: string; name: string }) => t.guid === TYPE_A && t.name === "Type A"));
    assert.ok(
      options.body.categories.some((c: { guid: string; name: string }) => c.guid === CAT_A && c.name === "Cat A"),
    );

    const byType = await request(app)
      .get(`/api/clients/v3/list?entity=legal&typeGuid=${TYPE_A}&page=1&pageSize=50`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(byType.status, 200);
    assert.ok(byType.body.items.every((i: { name: string }) => i.name === "Legal One"));
    assert.ok(!byType.body.items.some((i: { guid: string }) => i.guid === LEGAL_UNASSIGNED));

    const byMultiType = await request(app)
      .get(`/api/clients/v3/list?entity=legal&typeGuids=${TYPE_A},${TYPE_B}&page=1&pageSize=50`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(byMultiType.status, 200);
    assert.ok(byMultiType.body.total >= 1);

    const catalog = await request(app).get("/api/clients/v3/field-catalog").set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(catalog.status, 200);
    assert.ok(Array.isArray(catalog.body.items) && catalog.body.items.length > 0);

    const byCatB = await request(app)
      .get(`/api/clients/v3/list?entity=legal&categoryGuid=${CAT_B}&page=1&pageSize=50`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(byCatB.status, 200);
    assert.equal(byCatB.body.items.length, 1);
    assert.equal(byCatB.body.items[0].guid, LEGAL_UNASSIGNED);

    const missing = await request(app)
      .get("/api/clients/v3/list?entity=legal&missingManager=true&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(missing.status, 200);
    assert.ok(missing.body.items.some((i: { guid: string }) => i.guid === LEGAL_UNASSIGNED));
    assert.ok(!missing.body.items.some((i: { guid: string }) => i.guid === LEGAL));

    const adminUser = await createTestUser({
      databaseUrl,
      email: "admin-v3-filters-link@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Filters Link",
      role: "admin",
    });
    const managerEmail = "manager-v3-filter-scope@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager Filter",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M2,
      confirmedByUserId: adminUser.id,
    });
    const mgrCookie = await login(managerEmail);
    const withheldOptions = await request(app)
      .get("/api/clients/v3/options?entity=legal")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(withheldOptions.status, 200);
    assert.ok(!withheldOptions.body.types.some((t: { guid: string }) => t.guid === TYPE_A));
    const withheldList = await request(app)
      .get(`/api/clients/v3/list?entity=legal&typeGuid=${TYPE_A}&page=1&pageSize=50`)
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(withheldList.status, 200);
    assert.equal(withheldList.body.total, 0);
  });

  it("sync-status exposes exchangeV3Active", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const adminEmail = "admin-v3-sync@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Sync",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();
    const res = await request(app).get("/api/clients/sync-status").set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.exchangeV3Active, true);
  });

  it("sync-status GET does not finalize expired pending jobs for scoped user", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const managerEmail = "manager-v3-readonly@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager Readonly",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: manager.id,
    });
    await pool.query(
      `
        INSERT INTO onec_import_jobs (
          kind, mode, status, requested_at, expires_at, requested_by_user_id, job_source
        )
        VALUES (
          'regular_update_bundle',
          'apply',
          'pending',
          NOW() - INTERVAL '3 hours',
          NOW() - INTERVAL '1 hour',
          $1::uuid,
          'admin_manual'
        )
      `,
      [manager.id],
    );
    const before = await pool.query<{ id: string; status: string; error_code: string | null }>(
      `SELECT id::text, status, error_code FROM onec_import_jobs WHERE kind = 'regular_update_bundle' ORDER BY requested_at DESC LIMIT 1`,
    );
    await pool.end();
    await resetPoolForTests();

    const cookie = await login(managerEmail);
    const app = await loadApp();
    const res = await request(app).get("/api/clients/sync-status").set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const after = await poolAfter.query<{ id: string; status: string; error_code: string | null }>(
      `SELECT id::text, status, error_code FROM onec_import_jobs WHERE kind = 'regular_update_bundle' ORDER BY requested_at DESC LIMIT 1`,
    );
    await poolAfter.end();
    assert.equal(after.rows[0]?.id, before.rows[0]?.id);
    assert.equal(after.rows[0]?.status, "pending");
    assert.equal(after.rows[0]?.error_code, before.rows[0]?.error_code);
  });

  it("sync-status GET does not mutate regular update jobs", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const adminEmail = "admin-v3-readonly@example.com";
    const admin = await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Readonly",
      role: "admin",
    });
    await pool.query(
      `
        INSERT INTO onec_import_jobs (
          kind, mode, status, expires_at, requested_by_user_id, job_source
        )
        VALUES (
          'regular_update_bundle',
          'apply',
          'pending',
          NOW() + INTERVAL '2 hours',
          $1::uuid,
          'admin_manual'
        )
      `,
      [admin.id],
    );
    const before = await pool.query<{ id: string; status: string; finished_at: Date | null }>(
      `SELECT id::text, status, finished_at FROM onec_import_jobs WHERE kind = 'regular_update_bundle' ORDER BY requested_at DESC LIMIT 1`,
    );
    await pool.end();
    await resetPoolForTests();

    const cookie = await login(adminEmail);
    const app = await loadApp();
    await request(app).get("/api/clients/sync-status").set({ Origin: ORIGIN, Cookie: cookie });
    await request(app).get("/api/clients/sync-status").set({ Origin: ORIGIN, Cookie: cookie });

    const poolAfter = new Pool({ connectionString: databaseUrl, max: 1 });
    const after = await poolAfter.query<{ id: string; status: string; finished_at: Date | null }>(
      `SELECT id::text, status, finished_at FROM onec_import_jobs WHERE kind = 'regular_update_bundle' ORDER BY requested_at DESC LIMIT 1`,
    );
    await poolAfter.end();
    assert.equal(after.rows[0]?.id, before.rows[0]?.id);
    assert.equal(after.rows[0]?.status, before.rows[0]?.status);
    assert.equal(after.rows[0]?.finished_at, before.rows[0]?.finished_at);
  });

  it("sync-status uses v3 apply time when legacy import journal is empty", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DELETE FROM onec_client_import_runs`);
    await pool.query(`
      UPDATE onec_exchange_state
      SET last_successful_apply_at = NULL, last_attempt_at = NULL
      WHERE id = 1
    `);
    await pool.end();
    await resetPoolForTests();

    const adminEmail = "admin-v3-freshness@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Freshness",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();
    const res = await request(app).get("/api/clients/sync-status").set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.exchangeV3Active, true);
    assert.ok(res.body.v3LastSuccessfulApplyAt);
    assert.notEqual(res.body.freshnessState, "never");
    assert.equal(res.body.freshnessState, "current");
    assert.ok(res.body.lastSuccessfulImportAt);
  });
});
