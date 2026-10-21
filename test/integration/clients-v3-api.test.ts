import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests, query } from "../../src/db/pool";
import { legalPaymentTypeSql } from "../../src/clients/v3/list-sql-expressions";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { denyClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
const HOLDING = "a1000000-0000-4000-8000-000000000001";
const LEGAL = "b2000000-0000-4000-8000-000000000001";
const LEGAL_ORPHAN = "b2000000-0000-4000-8000-000000000002";
const RETAIL = "c3000000-0000-4000-8000-000000000001";
const ROP = "55555555-5555-4555-8555-555555555555";
const TYPE_A = "t1";
const CAT_A = "c1";
const TYPE_B = "t2";
const CAT_B = "c2";
const LEGAL_UNASSIGNED = "b2000000-0000-4000-8000-000000000003";
const LEGAL_TWO = "b2000000-0000-4000-8000-000000000004";

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

  function loadRetailWithLoadingDays(): Buffer {
    const retail = JSON.parse(loadFixture("all_retail.json").toString("utf8"));
    retail[0].information_loading = { loading_time: "10:00", loading_on_monday: true };
    retail[1].information_loading = { loading_on_monday: false };
    retail[3].information_loading = { loading_on_monday: true, loading_on_friday: true };
    return Buffer.from(JSON.stringify(retail));
  }

  function loadRetailLoadingDayTrueWinsContract(): Buffer {
    const retail = JSON.parse(loadFixture("all_retail.json").toString("utf8"));
    retail[0].information_loading = { loading_on_monday: true, loading_time: "10:00" };
    retail[1].information_loading = { loading_on_monday: false };
    retail[2].information_loading = {
      loadingOnMonday: "true",
      loading_on_monday: "false",
      loadingOnTuesday: false,
      loading_on_wednesday: 1,
      loadingOnThursday: {},
    };
    retail[3].information_loading = { loadingOnMonday: true, loading_on_friday: true, loading_on_monday: false };
    retail[3].managers = {
      guid_manager: M2,
      name_manager: "Manager Two",
    };
    return Buffer.from(JSON.stringify(retail));
  }

  async function seedV3LoadingDayTrueWinsContract(): Promise<void> {
    const holdings = JSON.parse(loadFixture("all_holding.json").toString("utf8"));
    const holdingsBytes = Buffer.from(JSON.stringify(holdings));
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(ROP, {
        name_manager: "ROP One",
        post: "Руководитель отдела продаж",
      }),
    ]);
    const retailBytes = loadRetailLoadingDayTrueWinsContract();
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes,
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes,
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    const applied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes,
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes,
      employeesBytes,
    });
    assert.equal(applied.status, "SUCCESS");
  }

  async function seedV3WithLoadingDays(completeHoldingMembership = false): Promise<void> {
    const holdings = JSON.parse(loadFixture("all_holding.json").toString("utf8"));
    if (completeHoldingMembership) {
      holdings[0].legal_entities.push({ guid_retail: LEGAL_TWO, name_retail: "Legal Two" });
    }
    const holdingsBytes = Buffer.from(JSON.stringify(holdings));
    const employeesBytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1, { name_manager: "Manager One" }),
      buildEmployeeRosterEntry(M2, { name_manager: "Manager Two" }),
      buildEmployeeRosterEntry(ROP, {
        name_manager: "ROP One",
        post: "Руководитель отдела продаж",
      }),
    ]);
    const retailBytes = loadRetailWithLoadingDays();
    const dry = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--dry-run"],
      holdingsBytes,
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes,
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    const applied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes,
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes,
      employeesBytes,
    });
    assert.equal(applied.status, "SUCCESS");
  }

  async function seedV3(completeHoldingMembership = false): Promise<void> {
    const holdings = JSON.parse(loadFixture("all_holding.json").toString("utf8"));
    if (completeHoldingMembership) {
      holdings[0].legal_entities.push({ guid_retail: LEGAL_TWO, name_retail: "Legal Two" });
    }
    const holdingsBytes = Buffer.from(JSON.stringify(holdings));
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
      holdingsBytes,
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(dry.status, "SUCCESS");
    const applied = await runExchangeV3RegularUpdate({
      env: { ...process.env, DATABASE_URL: databaseUrl },
      argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!],
      holdingsBytes,
      clientsBytes: loadFixture("all_clients.json"),
      retailBytes: loadFixture("all_retail.json"),
      employeesBytes,
    });
    assert.equal(applied.status, "SUCCESS");
  }

  it("wide session composition is narrowed to the selected employee and rejects invalid selectors", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    await resetPoolForTests();
    await query(
      `UPDATE onec_v3_retail_outlets
       SET managers = jsonb_set(managers, '{guidManager}', to_jsonb($1::text))
       WHERE guid_store IN (
         'c3000000-0000-4000-8000-000000000003'::uuid,
         'c3000000-0000-4000-8000-000000000004'::uuid
       )`,
      [M2],
    );
    const email = "admin-card-territory@example.test";
    await createTestUser({ databaseUrl, email, password: TEST_PASSWORD, fullName: "Card Test", role: "admin" });
    const cookie = await login(email);
    const app = await loadApp();
    const path = `/api/clients/v3/holdings/${HOLDING}/composition`;
    const headers = { Origin: ORIGIN, Cookie: cookie };
    const wide = await request(app).get(path).set(headers);
    assert.equal(wide.status, 200);
    assert.equal(wide.body.retailOutlets.length, 3);
    const selected = await request(app).get(`${path}?responsibleGuid=${M1}&responsibleKind=manager`).set(headers);
    assert.equal(selected.status, 200);
    assert.deepEqual(selected.body.retailOutlets.map((r: { guid: string }) => r.guid), [RETAIL]);
    const other = await request(app).get(`${path}?responsibleGuid=${M2}&responsibleKind=manager`).set(headers);
    assert.equal(other.status, 200);
    assert.equal(other.body.retailOutlets.length, 2);
    const invalid = await request(app).get(`${path}?responsibleGuid=invalid`).set(headers);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.retailOutlets, undefined);
    const invalidKind = await request(app).get(`${path}?responsibleGuid=${M1}&responsibleKind=admin`).set(headers);
    assert.equal(invalidKind.status, 400);
  });

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

  it("legal city/status fields and retail colStatus narrowing", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3();
    const adminEmail = "admin-v3-list-stage2@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Stage2",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();

    const legalList = await request(app)
      .get("/api/clients/v3/list?entity=legal&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(legalList.status, 200);
    const legalOne = legalList.body.items.find((i: { guid: string }) => i.guid === LEGAL);
    assert.ok(legalOne);
    assert.ok(!legalOne.city);
    assert.match(String(legalOne.address_line ?? ""), /SYNTH address/);
    assert.ok(!legalOne.status_label);
    assert.equal(legalOne.type_name, "Type A");
    assert.equal(legalOne.category_name, "Cat A");

    const legalOptions = await request(app)
      .get("/api/clients/v3/options?entity=legal")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(legalOptions.status, 200);
    assert.deepEqual(legalOptions.body.cities ?? [], []);

    const searchByManager = await request(app)
      .get("/api/clients/v3/list?entity=legal&q=Manager+One&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(searchByManager.status, 200);
    assert.ok(searchByManager.body.items.some((i: { guid: string }) => i.guid === LEGAL));

    const searchByCode = await request(app)
      .get("/api/clients/v3/list?entity=legal&q=SYNTH-001&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(searchByCode.status, 200);
    assert.ok(searchByCode.body.items.some((i: { guid: string }) => i.guid === LEGAL));

    const retailUnknownStatus = await request(app)
      .get("/api/clients/v3/list?entity=retail&colStatus=unknown-status-token&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(retailUnknownStatus.status, 200);
    assert.equal(retailUnknownStatus.body.total, 0);

    const managerEmail = "manager-v3-search-scope@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager Search",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: manager.id,
    });
    const mgrCookie = await login(managerEmail);
    const foreignSearch = await request(app)
      .get("/api/clients/v3/list?entity=legal&q=Legal+Two&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(foreignSearch.status, 200);
    assert.equal(foreignSearch.body.total, 0);
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
    const territoryOptions = await request(app)
      .get(`/api/clients/v3/options?entity=legal&responsibleGuid=${M1}&responsibleKind=manager`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(territoryOptions.status, 200);
    assert.deepEqual(territoryOptions.body.staff.managerGuid.map((m: { guid: string }) => m.guid), [M1]);
    const invalidTerritory = await request(app)
      .get("/api/clients/v3/options?entity=legal&responsibleGuid=invalid&responsibleKind=manager")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(invalidTerritory.status, 400);
    for (const [entity, rule] of [
      ["legal", { field: "discountAmount", op: "gte", value: "0" }],
      ["retail", { field: "warehouse", op: "no", value: "" }],
    ] as const) {
      const filtered = await request(app)
        .get(`/api/clients/v3/list?entity=${entity}&filters=${encodeURIComponent(JSON.stringify([rule]))}`)
        .set({ Origin: ORIGIN, Cookie: cookie });
      assert.equal(filtered.status, 200);
    }

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
    assert.ok(byMultiType.body.total >= 2);
    assert.ok(byMultiType.body.items.some((i: { guid: string }) => i.guid === LEGAL));
    assert.ok(byMultiType.body.items.some((i: { guid: string }) => i.guid === LEGAL_UNASSIGNED));

    const byTypeAndCategory = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&typeGuid=${TYPE_A}&categoryGuid=${CAT_A}&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(byTypeAndCategory.status, 200);
    assert.equal(byTypeAndCategory.body.total, 1);
    assert.equal(byTypeAndCategory.body.items[0].guid, LEGAL);

    const byMultiTypeAndCategory = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&typeGuids=${TYPE_A},${TYPE_B}&categoryGuid=${CAT_B}&page=1&pageSize=50`,
      )
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(byMultiTypeAndCategory.status, 200);
    assert.equal(byMultiTypeAndCategory.body.total, 1);
    assert.equal(byMultiTypeAndCategory.body.items[0].guid, LEGAL_UNASSIGNED);

    const catalogAnon = await request(app).get("/api/clients/v3/field-catalog").set({ Origin: ORIGIN });
    assert.equal(catalogAnon.status, 401);

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

    const catalogManager = await request(app)
      .get("/api/clients/v3/field-catalog")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(catalogManager.status, 403);

    const scopeAdmin = await request(app)
      .get("/api/clients/v3/scope-summary")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(scopeAdmin.status, 200);
    assert.ok(scopeAdmin.body.legal >= 1);
    assert.ok(scopeAdmin.body.retail >= 1);

    const scopeMgr = await request(app)
      .get("/api/clients/v3/scope-summary")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(scopeMgr.status, 200);
    assert.ok(scopeMgr.body.legal <= scopeAdmin.body.legal);

    const rulesRaw = encodeURIComponent(
      JSON.stringify([
        { field: "categoryGuid", op: "eq", value: CAT_A },
        { field: "typeGuid", op: "eq", value: TYPE_A },
      ]),
    );
    const byRules = await request(app)
      .get(`/api/clients/v3/list?entity=legal&filters=${rulesRaw}&page=1&pageSize=50`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(byRules.status, 200);
    assert.equal(byRules.body.total, 1);
    assert.equal(byRules.body.items[0].guid, LEGAL);
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

  it("legal_grouped merges holding members, excludes foreign legals, and keeps flat legal API", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3(true);
    const adminEmail = "admin-v3-grouped@example.com";
    const groupedAdmin = await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Grouped",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();
    const headers = { Origin: ORIGIN, Cookie: cookie };

    const flat = await request(app).get("/api/clients/v3/list?entity=legal&page=1&pageSize=50").set(headers);
    assert.equal(flat.status, 200);
    assert.ok(flat.body.total >= 4);

    const grouped = await request(app)
      .get("/api/clients/v3/list?entity=legal_grouped&page=1&pageSize=50")
      .set(headers);
    assert.equal(grouped.status, 200);
    assert.ok(grouped.body.total < flat.body.total);
    const holdingRow = grouped.body.items.find(
      (i: { group_key: string }) => i.group_key === `holding:${HOLDING}`,
    );
    assert.ok(holdingRow, "expected holding-backed group row");
    assert.equal(holdingRow.detail_entity, "holding");
    assert.equal(holdingRow.guid, HOLDING);
    assert.equal(holdingRow.name, "SYNTH Holding One");
    const legalGuids = (holdingRow.legal_entities as Array<{ guid: string }>).map((e) => e.guid);
    assert.ok(legalGuids.includes(LEGAL));
    assert.ok(legalGuids.includes(LEGAL_TWO));
    assert.equal(legalGuids.length, 2);
    assert.ok(grouped.body.items.some((item: { group_key: string }) => item.group_key === "legal:b2000000-0000-4000-8000-000000000002"));
    const firstPage = await request(app).get("/api/clients/v3/list?entity=legal_grouped&page=1&pageSize=1").set(headers);
    const secondPage = await request(app).get("/api/clients/v3/list?entity=legal_grouped&page=2&pageSize=1").set(headers);
    assert.equal(firstPage.status, 200);
    assert.equal(secondPage.status, 200);
    assert.equal(firstPage.body.total, grouped.body.total);
    assert.equal(secondPage.body.total, grouped.body.total);
    assert.notEqual(firstPage.body.items[0].group_key, secondPage.body.items[0].group_key);
    const groupedOptions = await request(app).get("/api/clients/v3/options?entity=legal_grouped").set(headers);
    assert.equal(groupedOptions.status, 200);
    assert.ok(!groupedOptions.body.categories.some((item: { guid: string }) => item.guid === "c3"));
    const categoryMismatch = await request(app)
      .get("/api/clients/v3/list?entity=legal_grouped&categoryGuid=c3").set(headers);
    assert.equal(categoryMismatch.status, 200);
    assert.equal(categoryMismatch.body.total, 0);
    const categoryGroup = await request(app)
      .get(`/api/clients/v3/list?entity=legal_grouped&categoryGuid=${CAT_A}`).set(headers);
    assert.equal(categoryGroup.status, 200);
    assert.equal(categoryGroup.body.total, 1);
    assert.equal(categoryGroup.body.items[0].legal_entities.length, 2);

    const legalNameFilter = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "legalName", op: "contains", value: "Legal Two" }]),
        )}`,
      )
      .set(headers);
    assert.equal(legalNameFilter.status, 200);
    assert.equal(legalNameFilter.body.total, 1);
    assert.equal(legalNameFilter.body.items[0].group_key, `holding:${HOLDING}`);
    assert.equal(legalNameFilter.body.items[0].legal_entities.length, 1);
    assert.equal(legalNameFilter.body.items[0].legal_entities[0].guid, LEGAL_TWO);
    const holdingNameOnly = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "legalName", op: "contains", value: "SYNTH Holding" }]),
        )}`,
      )
      .set(headers);
    assert.equal(holdingNameOnly.status, 200);
    assert.equal(holdingNameOnly.body.total, 0);

    const groupDisplayHolding = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "groupDisplayName", op: "contains", value: "SYNTH Holding One" }]),
        )}`,
      )
      .set(headers);
    assert.equal(groupDisplayHolding.status, 200);
    assert.equal(groupDisplayHolding.body.total, 1);
    assert.equal(groupDisplayHolding.body.items[0].name, "SYNTH Holding One");

    const groupDisplayOrphan = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "groupDisplayName", op: "eq", value: "Legal Orphan" }]),
        )}`,
      )
      .set(headers);
    assert.equal(groupDisplayOrphan.status, 200);
    assert.equal(groupDisplayOrphan.body.total, 1);
    assert.equal(groupDisplayOrphan.body.items[0].name, "Legal Orphan");

    const groupDisplayWithLegalName = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([
            { field: "groupDisplayName", op: "contains", value: "SYNTH Holding One" },
            { field: "legalName", op: "contains", value: "Legal One" },
          ]),
        )}`,
      )
      .set(headers);
    assert.equal(groupDisplayWithLegalName.status, 200);
    assert.equal(groupDisplayWithLegalName.body.total, 1);
    assert.equal(groupDisplayWithLegalName.body.items[0].legal_entities.length, 1);

    const innContainsLeading = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "inn", op: "contains", value: "0123456789" }]),
        )}`,
      )
      .set(headers);
    assert.equal(innContainsLeading.status, 200);
    assert.equal(innContainsLeading.body.total, 1);
    assert.equal(innContainsLeading.body.items[0].group_key, `holding:${HOLDING}`);
    assert.match(String(innContainsLeading.body.items[0].inn || ""), /0123456789/);

    const innEq = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "inn", op: "eq", value: "9988776655" }]),
        )}`,
      )
      .set(headers);
    assert.equal(innEq.status, 200);
    assert.equal(innEq.body.total, 1);
    assert.equal(innEq.body.items[0].legal_entities.length, 2);
    assert.ok(String(innEq.body.items[0].inn || "").includes("9988776655"));

    const innAndLegalName = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([
            { field: "inn", op: "eq", value: "0123456789" },
            { field: "legalName", op: "eq", value: "Legal One" },
          ]),
        )}`,
      )
      .set(headers);
    assert.equal(innAndLegalName.status, 200);
    assert.equal(innAndLegalName.body.total, 1);

    const innMismatchChild = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([
            { field: "inn", op: "eq", value: "0123456789" },
            { field: "legalName", op: "eq", value: "Legal Two" },
          ]),
        )}`,
      )
      .set(headers);
    assert.equal(innMismatchChild.status, 200);
    assert.equal(innMismatchChild.body.total, 0);

    const innEmpty = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "inn", op: "empty", value: "" }]),
        )}`,
      )
      .set(headers);
    assert.equal(innEmpty.status, 200);
    assert.ok(
      innEmpty.body.items.some((i: { group_key: string }) => i.group_key === `legal:${LEGAL_ORPHAN}`),
    );

    const legalDetail = await request(app)
      .get(`/api/clients/v3/detail?entity=legal&guid=${LEGAL}`)
      .set(headers);
    assert.equal(legalDetail.status, 200);
    assert.equal(legalDetail.body.entity.inn, "0123456789");
    assert.equal(legalDetail.body.entity.kpp, "770701001");

    const scope = await request(app).get("/api/clients/v3/scope-summary").set(headers);
    assert.equal(scope.status, 200);
    assert.equal(scope.body.legal, grouped.body.total);

    const managerEmail = "manager-v3-grouped@example.com";
    const adminUser = await createTestUser({
      databaseUrl,
      email: "admin-v3-grouped-link@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin Link",
      role: "admin",
    });
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager Grouped",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: adminUser.id,
    });
    const mgrCookie = await login(managerEmail);
    const mgrGrouped = await request(app)
      .get("/api/clients/v3/list?entity=legal_grouped&page=1&pageSize=50")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(mgrGrouped.status, 200);
    const mgrHolding = mgrGrouped.body.items.find(
      (i: { group_key: string }) => i.group_key === `holding:${HOLDING}`,
    );
    assert.ok(mgrHolding);
    assert.equal(mgrHolding.legal_entities.length, 1);
    assert.equal(mgrHolding.legal_entities[0].guid, LEGAL);
    const selected = await request(app)
      .get(`/api/clients/v3/list?entity=legal_grouped&responsibleGuid=${M1}&responsibleKind=manager`).set(headers);
    assert.equal(selected.status, 200);
    assert.equal(selected.body.total, mgrGrouped.body.total);
    assert.deepEqual(selected.body.items.map((item: { legal_entities: unknown[] }) => item.legal_entities),
      mgrGrouped.body.items.map((item: { legal_entities: unknown[] }) => item.legal_entities));
    const hiddenSiblingSearch = await request(app)
      .get("/api/clients/v3/list?entity=legal_grouped&q=Legal+Two")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(hiddenSiblingSearch.status, 200);
    assert.equal(hiddenSiblingSearch.body.total, 0);
    const hiddenLegalName = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "legalName", op: "contains", value: "Legal Two" }]),
        )}`,
      )
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(hiddenLegalName.status, 200);
    assert.equal(hiddenLegalName.body.total, 0);
    const hiddenInn = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "inn", op: "eq", value: "9988776655" }]),
        )}`,
      )
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(hiddenInn.status, 200);
    assert.equal(hiddenInn.body.total, 0);

    const holdingTopWithMemberManager = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&typeGuid=${TYPE_A}&filters=${encodeURIComponent(
          JSON.stringify([{ field: "managerGuid", op: "eq", value: M2 }]),
        )}`,
      )
      .set(headers);
    assert.equal(holdingTopWithMemberManager.status, 200);
    // Grouped TOP is the holding's own type (t1); member manager M2 still matches the holding row.
    assert.equal(holdingTopWithMemberManager.body.total, 1);
    assert.equal(holdingTopWithMemberManager.body.items[0].group_key, `holding:${HOLDING}`);

    const flatChildTypeAndManager = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal&typeGuid=${TYPE_A}&managerGuid=${M2}&page=1&pageSize=50`,
      )
      .set(headers);
    assert.equal(flatChildTypeAndManager.status, 200);
    assert.equal(flatChildTypeAndManager.body.total, 0);

    const typeOnly = await request(app)
      .get(`/api/clients/v3/list?entity=legal_grouped&typeGuid=${TYPE_A}&page=1&pageSize=50`)
      .set(headers);
    assert.equal(typeOnly.status, 200);
    const narrowed = typeOnly.body.items.find(
      (i: { group_key: string }) => i.group_key === `holding:${HOLDING}`,
    );
    assert.ok(narrowed);
    assert.equal(narrowed.legal_entities.length, 2);
    await denyClientAccess({ databaseUrl, userId: groupedAdmin.id, scopeType: "client", objectId: LEGAL_TWO, deniedByUserId: groupedAdmin.id });
    const deniedSibling = await request(app).get("/api/clients/v3/list?entity=legal_grouped").set(headers);
    assert.equal(deniedSibling.status, 200);
    assert.ok(!JSON.stringify(deniedSibling.body).includes("Legal Two"));
    const deniedSearch = await request(app).get("/api/clients/v3/list?entity=legal_grouped&q=Legal+Two").set(headers);
    assert.equal(deniedSearch.status, 200);
    assert.equal(deniedSearch.body.total, 0);
    const deniedOptions = await request(app).get("/api/clients/v3/options?entity=legal_grouped").set(headers);
    assert.equal(deniedOptions.status, 200);
    assert.ok(!deniedOptions.body.staff.hardwareGuid.some((item: { guid: string }) => item.guid === "77777777-7777-4777-8777-777777777777"));
    await denyClientAccess({ databaseUrl, userId: manager.id, scopeType: "client", objectId: HOLDING, deniedByUserId: adminUser.id });
    const deniedHolding = await request(app)
      .get("/api/clients/v3/list?entity=legal_grouped")
      .set({ Origin: ORIGIN, Cookie: mgrCookie });
    assert.equal(deniedHolding.status, 200);
    assert.ok(deniedHolding.body.items.every((item: { detail_entity: string }) => item.detail_entity === "legal"));
    assert.ok(!JSON.stringify(deniedHolding.body).includes("SYNTH Holding One"));
  });

  it("retail loading day filters use explicit booleans and keep loadingTime separate", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3WithLoadingDays();
    await resetPoolForTests();
    const adminEmail = "admin-v3-loading-day@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Loading Day",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();
    const headers = { Origin: ORIGIN, Cookie: cookie };

    const mondayYes = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnMonday", op: "yes", value: "" }]),
        )}`,
      )
      .set(headers);
    assert.equal(mondayYes.status, 200);
    assert.equal(mondayYes.body.total, 2);

    const mondayNo = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnMonday", op: "no", value: "" }]),
        )}`,
      )
      .set(headers);
    assert.equal(mondayNo.status, 200);
    assert.equal(mondayNo.body.total, 1);
    assert.equal(mondayNo.body.items[0].guid, "c3000000-0000-4000-8000-000000000002");

    const monAndFri = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&filters=${encodeURIComponent(
          JSON.stringify([
            { field: "loadingOnMonday", op: "yes", value: "" },
            { field: "loadingOnFriday", op: "yes", value: "" },
          ]),
        )}`,
      )
      .set(headers);
    assert.equal(monAndFri.status, 200);
    assert.equal(monAndFri.body.total, 1);
    assert.equal(monAndFri.body.items[0].guid, "c3000000-0000-4000-8000-000000000004");

    const timeOnly = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingTime", op: "contains", value: "10:00" }]),
        )}`,
      )
      .set(headers);
    assert.equal(timeOnly.status, 200);
    assert.equal(timeOnly.body.total, 1);
    assert.equal(timeOnly.body.items[0].guid, RETAIL);

    const rejectedLegal = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnMonday", op: "yes", value: "" }]),
        )}`,
      )
      .set(headers);
    assert.equal(rejectedLegal.status, 400);
  });

  it("retail loading day true-wins contract: camel/snake conflict, garbage, orphan, manager scope", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3LoadingDayTrueWinsContract();
    await resetPoolForTests();
    const adminEmail = "admin-v3-loading-day-contract@example.com";
    const adminUser = await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Loading Day Contract",
      role: "admin",
    });
    const managerEmail = "manager-v3-loading-day-contract@example.com";
    const manager = await createTestUser({
      databaseUrl,
      email: managerEmail,
      password: TEST_PASSWORD,
      fullName: "Manager Loading Day Contract",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: M1,
      confirmedByUserId: adminUser.id,
    });
    const adminCookie = await login(adminEmail);
    const mgrCookie = await login(managerEmail);
    const app = await loadApp();
    const adminHeaders = { Origin: ORIGIN, Cookie: adminCookie };
    const mgrHeaders = { Origin: ORIGIN, Cookie: mgrCookie };
    const CONFLICT = "c3000000-0000-4000-8000-000000000004";
    const ORPHAN = "c3000000-0000-4000-8000-000000000002";
    const GARBAGE = "c3000000-0000-4000-8000-000000000003";

    const mondayYes = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&pageSize=50&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnMonday", op: "yes", value: "" }]),
        )}`,
      )
      .set(adminHeaders);
    assert.equal(mondayYes.status, 200);
    const mondayYesGuids = mondayYes.body.items.map((i: { guid: string }) => i.guid);
    assert.ok(mondayYesGuids.includes(RETAIL));
    assert.ok(mondayYesGuids.includes(CONFLICT));
    assert.ok(!mondayYesGuids.includes(ORPHAN));
    assert.ok(!mondayYesGuids.includes(GARBAGE));

    const mondayNo = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&pageSize=50&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnMonday", op: "no", value: "" }]),
        )}`,
      )
      .set(adminHeaders);
    assert.equal(mondayNo.status, 200);
    assert.deepEqual(
      mondayNo.body.items.map((i: { guid: string }) => i.guid),
      [ORPHAN],
    );
    assert.ok(!mondayNo.body.items.some((i: { guid: string }) => i.guid === CONFLICT));

    const tuesdayNo = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&pageSize=50&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnTuesday", op: "no", value: "" }]),
        )}`,
      )
      .set(adminHeaders);
    assert.equal(tuesdayNo.status, 200);
    assert.deepEqual(tuesdayNo.body.items.map((i: { guid: string }) => i.guid), [GARBAGE]);

    const wednesdayYes = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnWednesday", op: "yes", value: "" }]),
        )}`,
      )
      .set(adminHeaders);
    assert.equal(wednesdayYes.status, 200);
    assert.equal(wednesdayYes.body.total, 0);

    const orphanMondayNo = await request(app)
      .get(
        `/api/clients/v3/list?entity=orphan_retail&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnMonday", op: "no", value: "" }]),
        )}`,
      )
      .set(adminHeaders);
    assert.equal(orphanMondayNo.status, 200);
    assert.equal(orphanMondayNo.body.total, 1);
    assert.equal(orphanMondayNo.body.items[0].guid, ORPHAN);

    const mgrMondayYes = await request(app)
      .get(
        `/api/clients/v3/list?entity=retail&pageSize=50&filters=${encodeURIComponent(
          JSON.stringify([{ field: "loadingOnMonday", op: "yes", value: "" }]),
        )}`,
      )
      .set(mgrHeaders);
    assert.equal(mgrMondayYes.status, 200);
    assert.ok(!mgrMondayYes.body.items.some((i: { guid: string }) => i.guid === CONFLICT));
    assert.ok(mgrMondayYes.body.items.some((i: { guid: string }) => i.guid === RETAIL));
  });

  it("legal payment_type null-safe and filter-aligned with list payload", async () => {
    await prepareDatabase(databaseUrl);
    await seedV3(true);
    const adminEmail = "admin-v3-payment@example.com";
    await createTestUser({
      databaseUrl,
      email: adminEmail,
      password: TEST_PASSWORD,
      fullName: "Admin Payment",
      role: "admin",
    });
    const cookie = await login(adminEmail);
    const app = await loadApp();
    const headers = { Origin: ORIGIN, Cookie: cookie };
    const orphanGuid = "b2000000-0000-4000-8000-000000000002";

    async function listGroupedPayment() {
      const res = await request(app)
        .get("/api/clients/v3/list?entity=legal_grouped&page=1&pageSize=50")
        .set(headers);
      assert.equal(res.status, 200);
      const row = res.body.items.find(
        (i: { group_key: string }) => i.group_key === `legal:${orphanGuid}`,
      ) as { payment_type?: string | null } | undefined;
      assert.ok(row, "expected Legal Orphan grouped row");
      return row;
    }

    await query(`UPDATE onec_v3_legal_entities SET other_fields = '{}'::jsonb WHERE guid_client = $1::uuid`, [
      orphanGuid,
    ]);
    assert.equal((await listGroupedPayment())?.payment_type ?? null, null);

    await query(
      `UPDATE onec_v3_legal_entities SET other_fields = '{"Оптовик_Наличные": null}'::jsonb WHERE guid_client = $1::uuid`,
      [orphanGuid],
    );
    assert.equal((await listGroupedPayment())?.payment_type ?? null, null);

    await query(
      `UPDATE onec_v3_legal_entities SET other_fields = '{"Оптовик_Наличные": ""}'::jsonb WHERE guid_client = $1::uuid`,
      [orphanGuid],
    );
    assert.equal((await listGroupedPayment())?.payment_type ?? null, null);

    await query(
      `UPDATE onec_v3_legal_entities SET other_fields = '{"Оптовик_Наличные": "maybe"}'::jsonb WHERE guid_client = $1::uuid`,
      [orphanGuid],
    );
    assert.equal((await listGroupedPayment())?.payment_type ?? null, null);

    const emptyFilter = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "paymentType", op: "empty", value: "" }]),
        )}`,
      )
      .set(headers);
    assert.equal(emptyFilter.status, 200);
    assert.ok(
      emptyFilter.body.items.some((i: { group_key: string }) => i.group_key === `legal:${orphanGuid}`),
    );

    const bankFilterMissing = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "paymentType", op: "eq", value: "Безналичный расчёт" }]),
        )}`,
      )
      .set(headers);
    assert.equal(bankFilterMissing.status, 200);
    assert.ok(
      !bankFilterMissing.body.items.some((i: { group_key: string }) => i.group_key === `legal:${orphanGuid}`),
    );

    await query(
      `UPDATE onec_v3_legal_entities SET other_fields = '{"Оптовик_Наличные": false}'::jsonb WHERE guid_client = $1::uuid`,
      [orphanGuid],
    );
    const rawFalse = await query(
      `SELECT ${legalPaymentTypeSql("le")} AS pt FROM onec_v3_legal_entities le WHERE guid_client = $1::uuid`,
      [orphanGuid],
    );
    assert.equal(rawFalse.rows[0]?.pt, "Безналичный расчёт");
    const bankFilterHas = await request(app)
      .get(
        `/api/clients/v3/list?entity=legal_grouped&filters=${encodeURIComponent(
          JSON.stringify([{ field: "paymentType", op: "eq", value: "Безналичный расчёт" }]),
        )}`,
      )
      .set(headers);
    assert.equal(bankFilterHas.status, 200);
    assert.ok(
      bankFilterHas.body.items.some((i: { group_key: string }) => i.group_key === `legal:${orphanGuid}`),
    );
    assert.equal((await listGroupedPayment()).payment_type ?? null, "Безналичный расчёт");

    await query(
      `UPDATE onec_v3_legal_entities SET other_fields = '{"Оптовик_Наличные": true}'::jsonb WHERE guid_client = $1::uuid`,
      [orphanGuid],
    );
    assert.equal((await listGroupedPayment()).payment_type, "Наличный расчёт");

    await query(
      `UPDATE onec_v3_legal_entities SET other_fields = '{"Оптовик_Наличные": "Да"}'::jsonb WHERE guid_client = $1::uuid`,
      [orphanGuid],
    );
    assert.equal((await listGroupedPayment()).payment_type, "Наличный расчёт");
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
