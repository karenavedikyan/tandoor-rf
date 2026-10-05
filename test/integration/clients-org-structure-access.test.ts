import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  addRopTeamMember,
  denyClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
  updateClientExtendedSnapshot,
} from "../helpers/clients-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";
let adminUserId = "";

const ROP_EMPLOYEE = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
const ROP_OTHER = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
const MANAGER_M1 = "22222222-2222-4222-8222-222222222222";
const MANAGER_M2 = "55555555-5555-4555-8555-555555555555";
const MANAGER_NO_ACCOUNT = "66666666-6666-4666-8666-666666666666";
const CLIENT_OK = "11111111-1111-4111-8111-111111111111";
const CLIENT_DENIED = "33333333-3333-4333-8333-333333333333";

let ropUserId = "";
let managerM1UserId = "";
let managerM2UserId = "";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
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
    .set(authHeaders())
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

const PROTECTED_GUIDS = [ROP_EMPLOYEE, ROP_OTHER, MANAGER_M1, MANAGER_M2, MANAGER_NO_ACCOUNT, CLIENT_OK, CLIENT_DENIED];

function assertNoOrgStructureLeak(body: unknown): void {
  const payload = body as { rops?: unknown; items?: unknown };
  assert.ok(!payload.rops);
  assert.ok(!payload.items);
  const serialized = JSON.stringify(body);
  for (const guid of PROTECTED_GUIDS) {
    assert.doesNotMatch(serialized, new RegExp(guid, "i"));
  }
}

function extendedSnapshot(headOfSalesGuid: string, managerGuid: string, managerName: string) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: "a".repeat(64),
    importedAt: new Date().toISOString(),
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: { guid: null, name: "", state: "not_provided" },
    hardwareManager: { guid: null, name: "", state: "not_provided" },
    headOfSales: {
      guid: headOfSalesGuid,
      name: "ROP Branch",
      state: "directory_unverified",
    },
    currentRetailOutlets: [],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

async function seedRoster(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
      VALUES (1, $1, 4)
      ON CONFLICT (id) DO UPDATE SET employee_count = 4, source_sha256 = EXCLUDED.source_sha256
    `,
    ["b".repeat(64)],
  );
  for (const [guid, name, post] of [
    [ROP_EMPLOYEE, "ROP Alpha", "Руководитель отдела продаж"],
    [ROP_OTHER, "ROP Beta", "Руководитель отдела продаж"],
    [MANAGER_M1, "Manager One", "Менеджер"],
    [MANAGER_M2, "Manager Two", "Менеджер"],
    [MANAGER_NO_ACCOUNT, "No Account Manager", "Менеджер"],
  ] as const) {
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
        VALUES ($1::uuid, $2, $3, '{}'::jsonb)
        ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager
      `,
      [guid, name, post],
    );
  }
  await pool.end();
}

describe("clients org structure access integration", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    adminUserId = admin.id;

    ropUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP User",
        role: "rop",
      })
    ).id;

    managerM1UserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-m1@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager One",
        role: "manager",
      })
    ).id;
    managerM2UserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-m2@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager Two",
        role: "manager",
      })
    ).id;

    await linkUserToEmployee({
      databaseUrl,
      userId: ropUserId,
      employeeId: ROP_EMPLOYEE,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerM1UserId,
      employeeId: MANAGER_M1,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerM2UserId,
      employeeId: MANAGER_M2,
      confirmedByUserId: adminUserId,
    });
    await addRopTeamMember({
      databaseUrl,
      ropUserId,
      memberUserId: managerM1UserId,
      createdByUserId: adminUserId,
    });
    await addRopTeamMember({
      databaseUrl,
      ropUserId,
      memberUserId: managerM2UserId,
      createdByUserId: adminUserId,
    });

    await seedRoster();
    await insertSuccessfulImportRun(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_OK,
        name_client: "Client OK",
        guid_manager: MANAGER_M1,
        name_manager: "Manager One",
      },
      {
        guid_client: CLIENT_DENIED,
        name_client: "Client Denied",
        guid_manager: MANAGER_M2,
        name_manager: "Manager Two",
      },
      {
        guid_client: "44444444-4444-4444-8444-444444444444",
        name_client: "Client No Account Mgr",
        guid_manager: MANAGER_NO_ACCOUNT,
        name_manager: "No Account Manager",
      },
    ]);

    for (const [guid, managerGuid, managerName] of [
      [CLIENT_OK, MANAGER_M1, "Manager One"],
      [CLIENT_DENIED, MANAGER_M2, "Manager Two"],
      ["44444444-4444-4444-8444-444444444444", MANAGER_NO_ACCOUNT, "No Account Manager"],
    ] as const) {
      await updateClientExtendedSnapshot(
        databaseUrl,
        guid,
        extendedSnapshot(ROP_EMPLOYEE, managerGuid, managerName),
      );
    }
  });

  after(async () => {
    await closePool();
  });

  it("A: hides responsibles and counts from denied clients in ROP branch", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: ropUserId,
      scopeType: "client",
      objectId: CLIENT_DENIED,
      deniedByUserId: adminUserId,
    });

    const cookie = await login("rop@example.com");
    const app = await loadApp();

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    const rop = overview.body.rops.find((item: { employeeGuid: string }) => item.employeeGuid === ROP_EMPLOYEE);
    assert.ok(rop);
    assert.equal(rop.uniqueClientCount, 2);
    assert.equal(rop.managerCount, 2);

    const responsibles = await request(app)
      .get(`/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(responsibles.status, 200);
    const guids = responsibles.body.items.map((item: { employeeGuid: string }) => item.employeeGuid);
    assert.ok(guids.includes(MANAGER_M1));
    assert.ok(!guids.includes(MANAGER_M2));
    assert.ok(guids.includes(MANAGER_NO_ACCOUNT));

    const m1 = responsibles.body.items.find((item: { employeeGuid: string }) => item.employeeGuid === MANAGER_M1);
    assert.equal(m1.clientCount, 1);
  });

  it("B: all_clients denial returns empty portfolio without leaking responsibles", async () => {
    await denyClientAccess({
      databaseUrl,
      userId: ropUserId,
      scopeType: "all_clients",
      deniedByUserId: adminUserId,
    });

    const cookie = await login("rop@example.com");
    const app = await loadApp();

    const overview = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overview.status, 200);
    assert.equal(overview.body.rops.length, 1);
    assert.equal(overview.body.rops[0].uniqueClientCount, 0);
    assert.equal(overview.body.rops[0].managerCount, 0);

    const responsibles = await request(app)
      .get(`/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(responsibles.status, 200);
    assert.equal(responsibles.body.items.length, 0);
  });

  it("C: ROP cannot open another ROP branch responsibles", async () => {
    const cookie = await login("rop@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/org-structure/${ROP_OTHER}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 403);
    assert.ok(!res.body.items);
  });

  it("D: inactive ROP session cannot load org structure after disable", async () => {
    const cookie = await login("rop@example.com");
    const app = await loadApp();

    const overviewBefore = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overviewBefore.status, 200);
    assert.ok(overviewBefore.body.rops.length > 0);
    assert.ok(overviewBefore.body.rops[0].uniqueClientCount > 0);

    const responsiblesBefore = await request(app)
      .get(`/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(responsiblesBefore.status, 200);
    assert.ok(responsiblesBefore.body.items.length > 0);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1::uuid`, [ropUserId]);
    await pool.end();
    await resetPoolForTests();

    const appAfter = await loadApp();
    const overviewAfter = await request(appAfter).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overviewAfter.status, 401);
    assert.equal(overviewAfter.body.error?.code, "UNAUTHORIZED");
    assertNoOrgStructureLeak(overviewAfter.body);

    const responsiblesAfter = await request(appAfter)
      .get(`/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(responsiblesAfter.status, 401);
    assert.equal(responsiblesAfter.body.error?.code, "UNAUTHORIZED");
    assertNoOrgStructureLeak(responsiblesAfter.body);
  });

  it("D: revoked employee-link blocks org structure on same session", async () => {
    const cookie = await login("rop@example.com");
    const app = await loadApp();

    const overviewBefore = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overviewBefore.status, 200);
    assert.ok(overviewBefore.body.rops[0].uniqueClientCount > 0);

    const responsiblesBefore = await request(app)
      .get(`/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`)
      .set(authHeaders(cookie));
    assert.equal(responsiblesBefore.status, 200);
    assert.ok(responsiblesBefore.body.items.length > 0);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [ropUserId],
    );
    await pool.end();
    await resetPoolForTests();

    const appAfter = await loadApp();
    for (const path of [
      "/api/clients/org-structure",
      `/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`,
    ] as const) {
      const res = await request(appAfter).get(path).set(authHeaders(cookie));
      assert.equal(res.status, 403, path);
      assert.equal(res.body.error?.code, "FORBIDDEN");
      assertNoOrgStructureLeak(res.body);
    }
  });

  it("D: employee-link conflict blocks org structure without leaking data", async () => {
    const cookie = await login("rop@example.com");
    const app = await loadApp();

    const overviewBefore = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(overviewBefore.status, 200);
    assert.ok(overviewBefore.body.rops[0].uniqueClientCount > 0);

    const conflictUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop-conflict@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP Conflict Twin",
        role: "rop",
      })
    ).id;

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DROP INDEX IF EXISTS user_onec_employee_links_active_employee_uq`);
    await pool.query(
      `
        INSERT INTO user_onec_employee_links (user_id, employee_id, basis, confirmed_by_user_id)
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
      `,
      [conflictUserId, ROP_EMPLOYEE, "integration conflict", adminUserId],
    );
    await pool.end();
    await resetPoolForTests();

    const appAfter = await loadApp();
    for (const path of [
      "/api/clients/org-structure",
      `/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`,
    ] as const) {
      const res = await request(appAfter).get(path).set(authHeaders(cookie));
      assert.equal(res.status, 403, path);
      assert.equal(res.body.error?.code, "FORBIDDEN");
      assertNoOrgStructureLeak(res.body);
    }
  });

  it("D: admin sees responsibles without LK account without creating users", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const linksBefore = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM user_onec_employee_links WHERE employee_id = $1::uuid`,
      [MANAGER_NO_ACCOUNT],
    );

    const responsibles = await request(app)
      .get(`/api/clients/org-structure/${ROP_EMPLOYEE}/responsibles`)
      .set(authHeaders(adminCookie));
    assert.equal(responsibles.status, 200);
    const noAccount = responsibles.body.items.find(
      (item: { employeeGuid: string }) => item.employeeGuid === MANAGER_NO_ACCOUNT,
    );
    assert.ok(noAccount);
    assert.equal(noAccount.hasLinkedAccount, false);

    const linksAfter = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM user_onec_employee_links WHERE employee_id = $1::uuid`,
      [MANAGER_NO_ACCOUNT],
    );
    await pool.end();
    assert.equal(linksAfter.rows[0]?.count, linksBefore.rows[0]?.count);
    assert.equal(linksAfter.rows[0]?.count, "0");
  });
});
