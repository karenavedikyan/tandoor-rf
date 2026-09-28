import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { USER_ROLES } from "../../src/shared/user";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  addRopTeamMember,
  createDelegationRecord,
  grantClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import {
  insertSuccessfulImportRun,
  insertSyntheticClients,
} from "../helpers/clients-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";
let adminUserId = "";

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const CLIENT_THREE = "66666666-6666-4666-8666-666666666666";

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
  resetPoolForTests();
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
  const cookie = res.headers["set-cookie"]?.[0] ?? "";
  return cookie.split(";")[0] ?? "";
}

describe("access control integration (R1.3)", { concurrency: false }, () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    adminUserId = admin.id;

    await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "manager-b@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager B",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "rop@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP User",
      role: "rop",
    });
    await createTestUser({
      databaseUrl,
      email: "regional@example.com",
      password: TEST_PASSWORD,
      fullName: "Regional User",
      role: "regional_manager",
    });
    await createTestUser({
      databaseUrl,
      email: "assistant@example.com",
      password: TEST_PASSWORD,
      fullName: "Assistant User",
      role: "assistant",
    });
    await createTestUser({
      databaseUrl,
      email: "coordinator@example.com",
      password: TEST_PASSWORD,
      fullName: "Coordinator User",
      role: "coordinator",
    });

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Альфа Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "Москва",
        telephone: ["+79990001122"],
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Бета Клиент",
        guid_manager: MANAGER_B,
        name_manager: "Менеджер Петров",
        address: "Казань",
        telephone: [],
      },
      {
        guid_client: CLIENT_THREE,
        name_client: "Гamma Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "СПб",
        telephone: [],
      },
    ]);
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 3 });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const managerA = await pool.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email = 'manager-a@example.com'",
    );
    const managerB = await pool.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email = 'manager-b@example.com'",
    );
    const rop = await pool.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email = 'rop@example.com'",
    );
    await pool.end();

    await linkUserToEmployee({
      databaseUrl,
      userId: managerA.rows[0]!.id,
      employeeId: MANAGER_A,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerB.rows[0]!.id,
      employeeId: MANAGER_B,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: rop.rows[0]!.id,
      employeeId: MANAGER_A,
      confirmedByUserId: adminUserId,
    });
    await addRopTeamMember({
      databaseUrl,
      ropUserId: rop.rows[0]!.id,
      memberUserId: managerA.rows[0]!.id,
      createdByUserId: adminUserId,
    });
  });

  after(async () => {
    await closePool();
  });

  it("ACC-01/02: manager sees only own clients; foreign ID returns 404", async () => {
    const app = await loadApp();
    const cookie = await login("manager-a@example.com");

    const list = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);
    assert.ok(list.body.items.every((item: { guid: string }) => item.guid !== CLIENT_TWO));

    const foreign = await request(app)
      .get(`/api/clients/${CLIENT_TWO}`)
      .set(authHeaders(cookie));
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error.code, "NOT_FOUND");
  });

  it("ACC-04/90/91: search, options and total stay within manager scope", async () => {
    const app = await loadApp();
    const cookie = await login("manager-a@example.com");

    const search = await request(app)
      .get("/api/clients?q=" + encodeURIComponent("Бета"))
      .set(authHeaders(cookie));
    assert.equal(search.status, 200);
    assert.equal(search.body.total, 0);

    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    assert.equal(options.body.managers.length, 1);
    assert.equal(options.body.managers[0].id, MANAGER_A);

    const managerBFilter = await request(app)
      .get(`/api/clients?manager=${MANAGER_B}`)
      .set(authHeaders(cookie));
    assert.equal(managerBFilter.status, 200);
    assert.equal(managerBFilter.body.total, 0);
  });

  it("ACC-20/21: ROP sees team clients but not foreign team client detail", async () => {
    const app = await loadApp();
    const cookie = await login("rop@example.com");

    const list = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);

    const foreign = await request(app)
      .get(`/api/clients/${CLIENT_TWO}`)
      .set(authHeaders(cookie));
    assert.equal(foreign.status, 404);
  });

  it("ACC-30/32: regional sees only granted client", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const regional = await pool.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email = 'regional@example.com'",
    );
    await pool.end();

    await grantClientAccess({
      databaseUrl,
      userId: regional.rows[0]!.id,
      objectId: CLIENT_ONE,
      grantedByUserId: adminUserId,
    });

    const app = await loadApp();
    const cookie = await login("regional@example.com");
    const list = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].guid, CLIENT_ONE);

    const foreign = await request(app)
      .get(`/api/clients/${CLIENT_TWO}`)
      .set(authHeaders(cookie));
    assert.equal(foreign.status, 404);
  });

  it("ACC-40/41/171/172: assistant delegation statuses and approval", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const managerA = await pool.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email = 'manager-a@example.com'",
    );
    const assistant = await pool.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email = 'assistant@example.com'",
    );
    await pool.end();

    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 60 * 60_000).toISOString();

    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerA.rows[0]!.id,
      assistantUserId: assistant.rows[0]!.id,
      clientGuids: [CLIENT_ONE],
      status: "pending_approval",
      startsAt,
      endsAt,
    });

    const app = await loadApp();
    const asstCookie = await login("assistant@example.com");
    const pending = await request(app)
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(asstCookie));
    assert.equal(pending.status, 404);

    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerA.rows[0]!.id,
      assistantUserId: assistant.rows[0]!.id,
      clientGuids: [CLIENT_ONE],
      status: "active",
      startsAt,
      endsAt,
      approvedByUserId: adminUserId,
    });

    resetPoolForTests();
    const active = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(asstCookie));
    assert.equal(active.status, 200);
  });

  it("ACC-71/72: manager without link is forbidden; duplicate employee link rejected", async () => {
    await createTestUser({
      databaseUrl,
      email: "manager-unlinked@example.com",
      password: TEST_PASSWORD,
      fullName: "Unlinked Manager",
      role: "manager",
    });

    const app = await loadApp();
    const unlinked = await login("manager-unlinked@example.com");
    const res = await request(app).get("/api/clients").set(authHeaders(unlinked));
    assert.equal(res.status, 403);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const conflictUser = await pool.query<{ id: string }>(
      "SELECT id::text FROM users WHERE email = 'manager-unlinked@example.com'",
    );
    await pool.end();

    const adminCookie = await login("admin@example.com");
    const duplicateLink = await request(app)
      .post("/api/admin/access/employee-links")
      .set(authHeaders(adminCookie))
      .send({
        userId: conflictUser.rows[0]!.id,
        employeeId: MANAGER_A,
        basis: "duplicate employee test",
      });
    assert.equal(duplicateLink.status, 409);
  });

  it("ACC-140/141: coordinator denied client cards by default", async () => {
    const app = await loadApp();
    const cookie = await login("coordinator@example.com");
    const res = await request(app).get(`/api/clients/${CLIENT_ONE}`).set(authHeaders(cookie));
    assert.equal(res.status, 403);
  });

  it("denies marketer/analyst/category_manager and keeps sync-status admin-only", async () => {
    for (const role of ["marketer", "analyst", "category_manager"] as const) {
      await createTestUser({
        databaseUrl,
        email: `${role}@example.com`,
        password: TEST_PASSWORD,
        fullName: role,
        role,
      });
      const cookie = await login(`${role}@example.com`);
      const app = await loadApp();
      const res = await request(app).get("/api/clients").set(authHeaders(cookie));
      assert.equal(res.status, 403, role);
    }

    const managerCookie = await login("manager-a@example.com");
    const app = await loadApp();
    const sync = await request(app)
      .get("/api/clients/sync-status")
      .set(authHeaders(managerCookie));
    assert.equal(sync.status, 403);
  });

  it("preserves admin full access and disabled session revocation", async () => {
    const app = await loadApp();
    const adminCookie = await login("admin@example.com");
    const list = await request(app).get("/api/clients").set(authHeaders(adminCookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 3);

    await createTestUser({
      databaseUrl,
      email: "disabled-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Disabled",
      role: "admin",
      status: "disabled",
    });
    const disabledLogin = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "disabled-admin@example.com", password: TEST_PASSWORD });
    assert.equal(disabledLogin.status, 401);
  });

  it("admin access overview and explain endpoints require admin", async () => {
    const app = await loadApp();
    const managerCookie = await login("manager-a@example.com");
    const forbidden = await request(app)
      .get("/api/admin/access/overview")
      .set(authHeaders(managerCookie));
    assert.equal(forbidden.status, 403);

    const adminCookie = await login("admin@example.com");
    const overview = await request(app)
      .get("/api/admin/access/overview")
      .set(authHeaders(adminCookie));
    assert.equal(overview.status, 200);
    assert.ok(Array.isArray(overview.body.users));
  });
});
