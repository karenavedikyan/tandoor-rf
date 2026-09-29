import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
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

const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const ROP_EMPLOYEE = "77777777-7777-4777-8777-777777777777";
const DIRECTOR_EMP = "88888888-8888-4888-8888-888888888888";
const REGIONAL_EMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSISTANT_EMP = "99999999-9999-4999-8999-999999999999";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const CLIENT_THREE = "66666666-6666-4666-8666-666666666666";

let adminUserId = "";
let managerAUserId = "";
let managerBUserId = "";
let ropUserId = "";
let regionalUserId = "";
let assistantUserId = "";
let directorUserId = "";

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
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function adminPost(path: string, body: unknown, adminCookie: string) {
  const app = await loadApp();
  return request(app).post(path).set(authHeaders(adminCookie)).send(body);
}

async function accessPost(path: string, body: unknown, cookie: string) {
  const app = await loadApp();
  return request(app).post(path).set(authHeaders(cookie)).send(body);
}

describe("access control integration (R1.3)", { concurrency: false }, () => {
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

    managerAUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-a@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager A",
        role: "manager",
      })
    ).id;
    managerBUserId = (
      await createTestUser({
        databaseUrl,
        email: "manager-b@example.com",
        password: TEST_PASSWORD,
        fullName: "Manager B",
        role: "manager",
      })
    ).id;
    ropUserId = (
      await createTestUser({
        databaseUrl,
        email: "rop@example.com",
        password: TEST_PASSWORD,
        fullName: "ROP User",
        role: "rop",
      })
    ).id;
    regionalUserId = (
      await createTestUser({
        databaseUrl,
        email: "regional@example.com",
        password: TEST_PASSWORD,
        fullName: "Regional User",
        role: "regional_manager",
      })
    ).id;
    assistantUserId = (
      await createTestUser({
        databaseUrl,
        email: "assistant@example.com",
        password: TEST_PASSWORD,
        fullName: "Assistant User",
        role: "assistant",
      })
    ).id;
    directorUserId = (
      await createTestUser({
        databaseUrl,
        email: "director@example.com",
        password: TEST_PASSWORD,
        fullName: "Director User",
        role: "director",
      })
    ).id;

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
        name_client: "Gamma Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "СПб",
        telephone: [],
      },
    ]);
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 3 });

    const adminCookie = await login("admin@example.com");
    for (const [userId, employeeId] of [
      [managerAUserId, MANAGER_A],
      [managerBUserId, MANAGER_B],
      [ropUserId, ROP_EMPLOYEE],
      [regionalUserId, REGIONAL_EMP],
      [assistantUserId, ASSISTANT_EMP],
      [directorUserId, DIRECTOR_EMP],
    ] as const) {
      const link = await adminPost(
        "/api/admin/access/employee-links",
        { userId, employeeId, basis: "integration setup" },
        adminCookie,
      );
      assert.equal(link.status, 201, JSON.stringify(link.body));
    }

    const team = await adminPost(
      "/api/admin/access/rop-teams",
      { ropUserId, memberUserId: managerAUserId, basis: "integration team" },
      adminCookie,
    );
    assert.equal(team.status, 201);

    const grant = await adminPost(
      "/api/admin/access/grants",
      { userId: regionalUserId, objectId: CLIENT_ONE, basis: "regional TT-X" },
      adminCookie,
    );
    assert.equal(grant.status, 201);
  });

  after(async () => {
    await closePool();
  });

  it("ACC-01/02/90/91: manager scope, options, search and foreign 404", async () => {
    const cookie = await login("manager-a@example.com");
    const app = await loadApp();

    const list = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);

    const options = await request(app).get("/api/clients/options").set(authHeaders(cookie));
    assert.equal(options.status, 200);
    assert.equal(options.body.managers.length, 1);

    const search = await request(app)
      .get("/api/clients?q=" + encodeURIComponent("Бета"))
      .set(authHeaders(cookie));
    assert.equal(search.body.total, 0);

    const foreign = await request(app)
      .get(`/api/clients/${CLIENT_TWO}`)
      .set(authHeaders(cookie));
    assert.equal(foreign.status, 404);
  });

  it("ACC-20/21: ROP team scope", async () => {
    const cookie = await login("rop@example.com");
    const app = await loadApp();
    const list = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);
    const foreign = await request(app)
      .get(`/api/clients/${CLIENT_TWO}`)
      .set(authHeaders(cookie));
    assert.equal(foreign.status, 404);
  });

  it("ACC-30: regional explicit grant only", async () => {
    const cookie = await login("regional@example.com");
    const app = await loadApp();
    const list = await request(app).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].guid, CLIENT_ONE);
  });

  it("ACC-71: manager without link gets 403", async () => {
    await createTestUser({
      databaseUrl,
      email: "unlinked@example.com",
      password: TEST_PASSWORD,
      fullName: "Unlinked",
      role: "manager",
    });
    const cookie = await login("unlinked@example.com");
    const res = await request(await loadApp()).get("/api/clients").set(authHeaders(cookie));
    assert.equal(res.status, 403);
  });

  it("delegation via API: manager creates, ROP approves, assistant reads", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const assistantCookie = await login("assistant@example.com");

    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "отпуск менеджера",
      },
      managerCookie,
    );
    assert.equal(create.status, 201, JSON.stringify(create.body));
    assert.equal(create.body.status, "pending_approval");
    const delegationId = create.body.id;

    const pending = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(pending.status, 404);

    const approve = await accessPost(
      `/api/access/delegations/${delegationId}/approve`,
      { basis: "согласовано РОП" },
      ropCookie,
    );
    assert.equal(approve.status, 200);

    const active = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(active.status, 200);
  });

  it("rejects admin self-approval without businessApproverUserId", async () => {
    const managerCookie = await login("manager-a@example.com");
    const adminCookie = await login("admin@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_THREE],
        startsAt,
        endsAt,
        submit: true,
        basis: "test",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const badApprove = await accessPost(
      `/api/access/delegations/${delegationId}/approve`,
      { basis: "admin bypass" },
      adminCookie,
    );
    assert.equal(badApprove.status, 403);

    const recordMissingRef = await adminPost(
      `/api/admin/access/delegations/${delegationId}/record-approval`,
      { businessApproverUserId: ropUserId, basis: "внешнее решение РОП" },
      adminCookie,
    );
    assert.equal(recordMissingRef.status, 400);

    const record = await adminPost(
      `/api/admin/access/delegations/${delegationId}/record-approval`,
      {
        businessApproverUserId: ropUserId,
        decisionReference: "EXT-2026-001",
        basis: "внешнее решение РОП",
      },
      adminCookie,
    );
    assert.equal(record.status, 200);
  });

  it("rejects foreign client in delegation create", async () => {
    const managerCookie = await login("manager-a@example.com");
    const startsAt = new Date(Date.now()).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE, CLIENT_TWO],
        startsAt,
        endsAt,
        submit: false,
        basis: "invalid mix",
      },
      managerCookie,
    );
    assert.equal(res.status, 403);
  });

  it("rejects status=active tampering on create", async () => {
    const managerCookie = await login("manager-a@example.com");
    const app = await loadApp();
    const startsAt = new Date(Date.now()).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await request(app)
      .post("/api/access/delegations")
      .set(authHeaders(managerCookie))
      .send({
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        status: "active",
        basis: "tamper",
      });
    assert.equal(res.status, 403);
  });

  it("allows employee link re-create after revoke", async () => {
    const adminCookie = await login("admin@example.com");
    const overview = await request(await loadApp())
      .get("/api/admin/access/overview")
      .set(authHeaders(adminCookie));
    const link = overview.body.links.find(
      (row: { user_id: string; revoked_at: string | null }) =>
        row.user_id === managerAUserId && !row.revoked_at,
    );
    assert.ok(link, "active manager-a link expected");

    const revoke = await adminPost(
      `/api/admin/access/employee-links/${link.id}/revoke`,
      { basis: "rotation", reason: "test revoke" },
      adminCookie,
    );
    assert.equal(revoke.status, 200);

    const blocked = await login("manager-a@example.com");
    const blockedList = await request(await loadApp())
      .get("/api/clients")
      .set(authHeaders(blocked));
    assert.equal(blockedList.status, 403);

    const recreate = await adminPost(
      "/api/admin/access/employee-links",
      { userId: managerAUserId, employeeId: MANAGER_A, basis: "re-link after revoke" },
      adminCookie,
    );
    assert.equal(recreate.status, 201);
  });

  it("explicit denial blocks manager client access", async () => {
    const adminCookie = await login("admin@example.com");
    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: managerAUserId,
        scopeType: "client",
        objectId: CLIENT_ONE,
        reason: "explicit block",
        basis: "audit test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const cookie = await login("manager-a@example.com");
    const detail = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(cookie));
    assert.equal(detail.status, 404);

    const list = await request(await loadApp()).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.body.total, 1);
  });

  it("director requires employee link for client access", async () => {
    const cookie = await login("director@example.com");
    const list = await request(await loadApp()).get("/api/clients").set(authHeaders(cookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 3);
  });

  it("coordinator cannot read client cards", async () => {
    await createTestUser({
      databaseUrl,
      email: "coordinator@example.com",
      password: TEST_PASSWORD,
      fullName: "Coordinator User",
      role: "coordinator",
    });
    const cookie = await login("coordinator@example.com");
    const res = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 403);
  });

  it("disabled user explain shows no access", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1::uuid", [managerAUserId]);
    await pool.end();
    await resetPoolForTests();

    const adminCookie = await login("admin@example.com");
    const explain = await request(await loadApp())
      .get(
        `/api/admin/access/explain?userId=${managerAUserId}&clientGuid=${CLIENT_ONE}`,
      )
      .set(authHeaders(adminCookie));
    assert.equal(explain.status, 200);
    assert.equal(explain.body.explain.allowed, false);
    assert.equal(explain.body.explain.reason, "user_disabled");
  });

  it("ACC-170/171: pending_approval blocks assistant even when starts_at passed", async () => {
    const managerCookie = await login("manager-a@example.com");
    const assistantCookie = await login("assistant@example.com");
    const startsAt = new Date(Date.now() - 3600_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "pending window",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    assert.equal(create.body.status, "pending_approval");

    const blocked = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(blocked.status, 404);
  });

  it("ACC-120/121: delegation access respects starts_at and ends_at", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const assistantCookie = await login("assistant@example.com");

    const startsAt = new Date(Date.now() + 120_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "future start",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const approve = await accessPost(
      `/api/access/delegations/${delegationId}/approve`,
      { basis: "approved future" },
      ropCookie,
    );
    assert.equal(approve.status, 200);

    const beforeStart = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(beforeStart.status, 404);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      "UPDATE delegations SET starts_at = NOW() - INTERVAL '1 minute' WHERE id = $1::uuid",
      [delegationId],
    );
    await pool.end();
    await resetPoolForTests();

    const afterStart = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(afterStart.status, 200);
  });

  it("rejects foreign ROP approval for another team", async () => {
    const foreignRop = await createTestUser({
      databaseUrl,
      email: "rop-foreign@example.com",
      password: TEST_PASSWORD,
      fullName: "Foreign ROP",
      role: "rop",
    });
    const adminCookie = await login("admin@example.com");
    const link = await adminPost(
      "/api/admin/access/employee-links",
      {
        userId: foreignRop.id,
        employeeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        basis: "foreign rop link",
      },
      adminCookie,
    );
    assert.equal(link.status, 201);

    const managerCookie = await login("manager-a@example.com");
    const foreignRopCookie = await login("rop-foreign@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "foreign rop test",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);

    const badApprove = await accessPost(
      `/api/access/delegations/${create.body.id}/approve`,
      { basis: "foreign team" },
      foreignRopCookie,
    );
    assert.equal(badApprove.status, 403);
  });

  it("ACC-47: assistant cannot create delegation", async () => {
    const assistantCookie = await login("assistant@example.com");
    const startsAt = new Date(Date.now()).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: false,
        basis: "assistant re-delegate",
      },
      assistantCookie,
    );
    assert.equal(res.status, 403);
  });

  it("change request does not expand access until ROP approves", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const assistantCookie = await login("assistant@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "change request base",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const approve = await accessPost(
      `/api/access/delegations/${delegationId}/approve`,
      { basis: "initial approve" },
      ropCookie,
    );
    assert.equal(approve.status, 200);

    const onlyOne = await request(await loadApp())
      .get(`/api/clients/${CLIENT_THREE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(onlyOne.status, 404);

    const change = await accessPost(
      `/api/access/delegations/${delegationId}/change-requests`,
      {
        clientGuids: [CLIENT_ONE, CLIENT_THREE],
        startsAt,
        endsAt,
        basis: "expand clients",
      },
      managerCookie,
    );
    assert.equal(change.status, 201);

    const stillBlocked = await request(await loadApp())
      .get(`/api/clients/${CLIENT_THREE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(stillBlocked.status, 404);

    const approveChange = await accessPost(
      `/api/access/delegations/change-requests/${change.body.id}/approve`,
      { basis: "approve expansion" },
      ropCookie,
    );
    assert.equal(approveChange.status, 200);

    const expanded = await request(await loadApp())
      .get(`/api/clients/${CLIENT_THREE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(expanded.status, 200);
  });

  it("revoking one overlapping delegation leaves the other active", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const assistantCookie = await login("assistant@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const createFirst = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "overlap one",
      },
      managerCookie,
    );
    assert.equal(createFirst.status, 201);
    const createSecond = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_THREE],
        startsAt,
        endsAt,
        submit: true,
        basis: "overlap two",
      },
      managerCookie,
    );
    assert.equal(createSecond.status, 201);

    for (const id of [createFirst.body.id, createSecond.body.id]) {
      const approved = await accessPost(
        `/api/access/delegations/${id}/approve`,
        { basis: "overlap approve" },
        ropCookie,
      );
      assert.equal(approved.status, 200);
    }

    const revoke = await accessPost(
      `/api/access/delegations/${createFirst.body.id}/revoke`,
      { basis: "revoke first", reason: "overlap test" },
      managerCookie,
    );
    assert.equal(revoke.status, 200);

    const lost = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(lost.status, 404);

    const kept = await request(await loadApp())
      .get(`/api/clients/${CLIENT_THREE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(kept.status, 200);
  });

  it("double approve returns conflict on second attempt", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "double approve",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);

    const first = await accessPost(
      `/api/access/delegations/${create.body.id}/approve`,
      { basis: "first approve" },
      ropCookie,
    );
    assert.equal(first.status, 200);

    const second = await accessPost(
      `/api/access/delegations/${create.body.id}/approve`,
      { basis: "second approve" },
      ropCookie,
    );
    assert.equal(second.status, 409);
  });

  it("blocks foreign explain: manager B cannot diagnose manager A", async () => {
    const managerBCookie = await login("manager-b@example.com");
    const res = await request(await loadApp())
      .get(
        `/api/access/explain?userId=${managerAUserId}&clientGuid=${CLIENT_ONE}`,
      )
      .set(authHeaders(managerBCookie));
    assert.equal(res.status, 404);
  });

  it("manager can explain only self", async () => {
    const managerCookie = await login("manager-a@example.com");
    const res = await request(await loadApp())
      .get(
        `/api/access/explain?userId=${managerAUserId}&clientGuid=${CLIENT_ONE}`,
      )
      .set(authHeaders(managerCookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.explain.allowed, true);
  });

  it("hides client existence on self explain: foreign and missing GUID both 404", async () => {
    const managerBCookie = await login("manager-b@example.com");
    const app = await loadApp();
    const foreignRes = await request(app)
      .get(`/api/access/explain?userId=${managerBUserId}&clientGuid=${CLIENT_ONE}`)
      .set(authHeaders(managerBCookie));
    const missingGuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const missingRes = await request(app)
      .get(`/api/access/explain?userId=${managerBUserId}&clientGuid=${missingGuid}`)
      .set(authHeaders(managerBCookie));
    assert.equal(foreignRes.status, 404);
    assert.equal(missingRes.status, 404);
    assert.deepEqual(foreignRes.body, missingRes.body);
  });

  it("admin explain still distinguishes missing client for diagnostics", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const foreignRes = await request(app)
      .get(`/api/admin/access/explain?userId=${managerBUserId}&clientGuid=${CLIENT_ONE}`)
      .set(authHeaders(adminCookie));
    const missingGuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const missingRes = await request(app)
      .get(`/api/admin/access/explain?userId=${managerBUserId}&clientGuid=${missingGuid}`)
      .set(authHeaders(adminCookie));
    assert.equal(foreignRes.status, 200);
    assert.equal(missingRes.status, 200);
    assert.equal(foreignRes.body.explain.reason, "not_in_scope");
    assert.equal(missingRes.body.explain.reason, "client_not_found");
  });

  it("ROP cannot explain team member with client outside ROP scope", async () => {
    const ropCookie = await login("rop@example.com");
    const res = await request(await loadApp())
      .get(`/api/access/explain?userId=${managerBUserId}&clientGuid=${CLIENT_TWO}`)
      .set(authHeaders(ropCookie));
    assert.equal(res.status, 404);
  });

  it("denial on manager blocks assistant delegation access", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const assistantCookie = await login("assistant@example.com");
    const adminCookie = await login("admin@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "before denial",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const approve = await accessPost(
      `/api/access/delegations/${create.body.id}/approve`,
      { basis: "approve before denial" },
      ropCookie,
    );
    assert.equal(approve.status, 200);

    const activeBefore = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(activeBefore.status, 200);

    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: managerAUserId,
        scopeType: "client",
        objectId: CLIENT_ONE,
        reason: "block delegation path",
        basis: "test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const managerBlocked = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(managerCookie));
    assert.equal(managerBlocked.status, 404);

    const assistantBlocked = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(assistantBlocked.status, 404);
  });

  it("director can revoke delegation in scope", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const directorCookie = await login("director@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_THREE],
        startsAt,
        endsAt,
        submit: true,
        basis: "director revoke test",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);

    const approve = await accessPost(
      `/api/access/delegations/${create.body.id}/approve`,
      { basis: "rop approve" },
      ropCookie,
    );
    assert.equal(approve.status, 200);

    const revoke = await accessPost(
      `/api/access/delegations/${create.body.id}/revoke`,
      { basis: "director revoke", reason: "director decision" },
      directorCookie,
    );
    assert.equal(revoke.status, 200);
  });

  it("rejects partial invalid clientGuids array with 400", async () => {
    const managerCookie = await login("manager-a@example.com");
    const startsAt = new Date(Date.now()).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE, "not-a-uuid"],
        startsAt,
        endsAt,
        submit: false,
        basis: "invalid mix",
      },
      managerCookie,
    );
    assert.equal(res.status, 400);
  });

  it("rolls back delegation create on injected client write fault", async () => {
    const { setTestFaultAfterDelegationClients } = await import("../../src/access/service");
    setTestFaultAfterDelegationClients(true);
    try {
      const managerCookie = await login("manager-a@example.com");
      const startsAt = new Date(Date.now()).toISOString();
      const endsAt = new Date(Date.now() + 3600_000).toISOString();
      const res = await accessPost(
        "/api/access/delegations",
        {
          assistantUserId,
          clientGuids: [CLIENT_ONE],
          startsAt,
          endsAt,
          submit: false,
          basis: "fault injection",
        },
        managerCookie,
      );
      assert.equal(res.status, 409);

      const adminCookie = await login("admin@example.com");
      const overview = await request(await loadApp())
        .get("/api/admin/access/overview")
        .set(authHeaders(adminCookie));
      const created = overview.body.delegations.filter(
        (row: { delegator_email: string; status: string }) =>
          row.delegator_email === "manager-a@example.com" && row.status === "draft",
      );
      assert.equal(created.length, 0);
    } finally {
      setTestFaultAfterDelegationClients(false);
    }
  });

  it("serialized approve then revoke: both succeed, final revoked", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const assistantCookie = await login("assistant@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "concurrency approve then revoke",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const approveRes = await accessPost(
      `/api/access/delegations/${delegationId}/approve`,
      { basis: "first approve" },
      ropCookie,
    );
    assert.equal(approveRes.status, 200);

    const active = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(active.status, 200);

    const revokeRes = await accessPost(
      `/api/access/delegations/${delegationId}/revoke`,
      { basis: "then revoke", reason: "after approve" },
      managerCookie,
    );
    assert.equal(revokeRes.status, 200);

    const blocked = await request(await loadApp())
      .get(`/api/clients/${CLIENT_ONE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(blocked.status, 404);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query(
      "SELECT status, revoked_at IS NOT NULL AS revoked FROM delegations WHERE id = $1::uuid",
      [delegationId],
    );
    await pool.end();
    assert.equal(row.rows[0]?.status, "revoked");
    assert.equal(row.rows[0]?.revoked, true);
  });

  it("concurrent revoke before approve: approve rejected, final revoked", async () => {
    const {
      armConcurrencyHold,
      releaseConcurrencyHold,
      waitForConcurrencyHoldAcquired,
    } = await import("../../src/access/service");
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const assistantCookie = await login("assistant@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_THREE],
        startsAt,
        endsAt,
        submit: true,
        basis: "concurrency revoke first",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    armConcurrencyHold("revoke");
    const app = await loadApp();
    const revokeInflight = request(app)
      .post(`/api/access/delegations/${delegationId}/revoke`)
      .set(authHeaders(managerCookie))
      .send({ basis: "revoke first", reason: "race" });
    const revokePromise = revokeInflight.then((response) => response);
    await waitForConcurrencyHoldAcquired();
    const approveInflight = request(app)
      .post(`/api/access/delegations/${delegationId}/approve`)
      .set(authHeaders(ropCookie))
      .send({ basis: "late approve" });
    const approvePromise = approveInflight.then((response) => response);
    releaseConcurrencyHold();
    const [revokeRes, approveRes] = await Promise.all([revokePromise, approvePromise]);
    assert.equal(revokeRes.status, 200);
    assert.equal(approveRes.status, 409);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query(
      "SELECT status, revoked_at IS NOT NULL AS revoked FROM delegations WHERE id = $1::uuid",
      [delegationId],
    );
    await pool.end();
    assert.equal(row.rows[0]?.status, "revoked");
    assert.equal(row.rows[0]?.revoked, true);

    const blocked = await request(app)
      .get(`/api/clients/${CLIENT_THREE}`)
      .set(authHeaders(assistantCookie));
    assert.equal(blocked.status, 404);
  });

  it("concurrent propose change supersedes stale approve-change attempt", async () => {
    const { armConcurrencyHold, releaseConcurrencyHold } = await import("../../src/access/service");
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "change race base",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;
    await accessPost(
      `/api/access/delegations/${delegationId}/approve`,
      { basis: "approve base" },
      ropCookie,
    );

    const changeA = await accessPost(
      `/api/access/delegations/${delegationId}/change-requests`,
      {
        clientGuids: [CLIENT_ONE, CLIENT_THREE],
        startsAt,
        endsAt,
        basis: "change A",
      },
      managerCookie,
    );
    assert.equal(changeA.status, 201);
    const changeAId = changeA.body.id;

    armConcurrencyHold("propose-change");
    const proposePromise = accessPost(
      `/api/access/delegations/${delegationId}/change-requests`,
      {
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt: new Date(Date.now() + 7200_000).toISOString(),
        basis: "change B",
      },
      managerCookie,
    );
    await new Promise((r) => setTimeout(r, 50));
    const approvePromise = accessPost(
      `/api/access/delegations/change-requests/${changeAId}/approve`,
      { basis: "approve stale A" },
      ropCookie,
    );
    releaseConcurrencyHold();
    const [proposeRes, approveRes] = await Promise.all([proposePromise, approvePromise]);
    assert.equal(proposeRes.status, 201);
    assert.ok(approveRes.status === 404 || approveRes.status === 409);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const pending = await pool.query(
      `
        SELECT id::text, status
        FROM delegation_change_requests
        WHERE delegation_id = $1::uuid AND status = 'pending_approval'
      `,
      [delegationId],
    );
    await pool.end();
    assert.equal(pending.rows.length, 1);
    assert.notEqual(pending.rows[0]?.id, changeAId);
  });

  it("disabled manager session loses client access without cache bypass", async () => {
    const cookie = await login("manager-a@example.com");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1::uuid", [managerAUserId]);
    await pool.end();
    await resetPoolForTests();

    const res = await request(await loadApp()).get("/api/clients").set(authHeaders(cookie));
    assert.ok(res.status === 401 || res.status === 403);
  });

  it("director and coordinator can load scoped overview", async () => {
    const directorCookie = await login("director@example.com");
    const directorOverview = await request(await loadApp())
      .get("/api/access/overview")
      .set(authHeaders(directorCookie));
    assert.equal(directorOverview.status, 200);
    assert.ok(Array.isArray(directorOverview.body.delegations));

    const coordinator = await createTestUser({
      databaseUrl,
      email: "coord2@example.com",
      password: TEST_PASSWORD,
      fullName: "Coord Two",
      role: "coordinator",
    });
    const adminCookie = await login("admin@example.com");
    const coordAssign = await adminPost(
      "/api/admin/access/coordinator-teams",
      {
        coordinatorUserId: coordinator.id,
        ropUserId,
        basis: "integration coordinator team",
      },
      adminCookie,
    );
    assert.equal(coordAssign.status, 201);

    const coordCookie = await login("coord2@example.com");
    const coordOverview = await request(await loadApp())
      .get("/api/access/overview")
      .set(authHeaders(coordCookie));
    assert.equal(coordOverview.status, 200);
    assert.ok(Array.isArray(coordOverview.body.teams));
  });

  it("coordinator delegator client picker returns minimal fields only", async () => {
    const coordinator = await createTestUser({
      databaseUrl,
      email: "coord-picker@example.com",
      password: TEST_PASSWORD,
      fullName: "Coord Picker",
      role: "coordinator",
    });
    const adminCookie = await login("admin@example.com");
    await adminPost(
      "/api/admin/access/coordinator-teams",
      {
        coordinatorUserId: coordinator.id,
        ropUserId,
        basis: "picker minimal dto",
      },
      adminCookie,
    );
    const coordCookie = await login("coord-picker@example.com");
    const res = await request(await loadApp())
      .get(
        `/api/access/delegators/${managerAUserId}/clients?page=1&pageSize=10&q=${encodeURIComponent("Альфа")}`,
      )
      .set(authHeaders(coordCookie));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length >= 1);
    const item = res.body.items[0];
    assert.deepEqual(Object.keys(item).sort(), ["guid", "name"]);
    assert.equal(item.guid, CLIENT_ONE);
    assert.match(item.name, /Альфа/);
    assert.equal(res.body.holding, undefined);
    assert.equal(res.body.address, undefined);
    assert.equal(res.body.phonePreview, undefined);
    assert.equal(typeof res.body.total, "number");
    assert.equal(typeof res.body.page, "number");
    assert.equal(typeof res.body.pageSize, "number");
    assert.equal(typeof res.body.totalPages, "number");
  });

  it("coordinator cannot load client picker for foreign team manager", async () => {
    const coordinator = await createTestUser({
      databaseUrl,
      email: "coord-foreign@example.com",
      password: TEST_PASSWORD,
      fullName: "Coord Foreign",
      role: "coordinator",
    });
    const adminCookie = await login("admin@example.com");
    await adminPost(
      "/api/admin/access/coordinator-teams",
      {
        coordinatorUserId: coordinator.id,
        ropUserId,
        basis: "picker foreign guard",
      },
      adminCookie,
    );
    const coordCookie = await login("coord-foreign@example.com");
    const res = await request(await loadApp())
      .get(`/api/access/delegators/${managerBUserId}/clients?page=1&pageSize=10`)
      .set(authHeaders(coordCookie));
    assert.equal(res.status, 404);
    assert.equal(res.body.items, undefined);
    assert.equal(res.body.total, undefined);
  });

  it("all_clients deny hides client composition in delegation detail and overview", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const adminCookie = await login("admin@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "before all_clients deny",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: managerAUserId,
        scopeType: "all_clients",
        reason: "global deny detail leak test",
        basis: "test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const clientsApi = await request(await loadApp())
      .get("/api/clients")
      .set(authHeaders(managerCookie));
    assert.equal(clientsApi.status, 403);

    const detail = await request(await loadApp())
      .get(`/api/access/delegations/${delegationId}`)
      .set(authHeaders(managerCookie));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.delegation.clients, null);
    assert.equal(detail.body.delegation.clients_access, "restricted");
    assert.doesNotMatch(JSON.stringify(detail.body), /Альфа/);
    assert.doesNotMatch(JSON.stringify(detail.body), new RegExp(CLIENT_ONE));

    const overview = await request(await loadApp())
      .get("/api/access/overview")
      .set(authHeaders(managerCookie));
    assert.equal(overview.status, 200);
    const row = overview.body.delegations.find((item: { id: string }) => item.id === delegationId);
    assert.ok(row);
    assert.equal(row.client_count, null);
    assert.equal(row.clients_access, "restricted");

    const ropDetail = await request(await loadApp())
      .get(`/api/access/delegations/${delegationId}`)
      .set(authHeaders(ropCookie));
    assert.equal(ropDetail.status, 200);
    assert.equal(ropDetail.body.delegation.clients_access, "visible");
    assert.ok(Array.isArray(ropDetail.body.delegation.clients));
    assert.ok(ropDetail.body.delegation.clients.length >= 1);

    const approve = await accessPost(
      `/api/access/delegations/${delegationId}/approve`,
      { basis: "blocked by delegator deny" },
      ropCookie,
    );
    assert.equal(approve.status, 403);

    const revoke = await accessPost(
      `/api/access/delegations/${delegationId}/revoke`,
      { basis: "denied manager revoke", reason: "policy" },
      managerCookie,
    );
    assert.equal(revoke.status, 200);
  });

  it("single client deny hides composition without leaking denied client", async () => {
    const managerCookie = await login("manager-a@example.com");
    const adminCookie = await login("admin@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE, CLIENT_THREE],
        startsAt,
        endsAt,
        submit: true,
        basis: "partial deny leak test",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: managerAUserId,
        scopeType: "client",
        objectId: CLIENT_ONE,
        reason: "hide alpha only",
        basis: "test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const detail = await request(await loadApp())
      .get(`/api/access/delegations/${delegationId}`)
      .set(authHeaders(managerCookie));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.delegation.clients, null);
    assert.equal(detail.body.delegation.clients_access, "restricted");
    assert.doesNotMatch(JSON.stringify(detail.body), /Альфа/);
    assert.doesNotMatch(JSON.stringify(detail.body), new RegExp(CLIENT_ONE));
    assert.doesNotMatch(JSON.stringify(detail.body), /Gamma/);
  });

  it("ROP caller all_clients deny hides picker, detail, and overview composition", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const adminCookie = await login("admin@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: true,
        basis: "before rop caller deny",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: ropUserId,
        scopeType: "all_clients",
        reason: "rop global deny picker leak",
        basis: "test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const picker = await request(await loadApp())
      .get(`/api/access/delegators/${managerAUserId}/clients?page=1&pageSize=10`)
      .set(authHeaders(ropCookie));
    assert.equal(picker.status, 200);
    assert.deepEqual(picker.body.items, []);
    assert.equal(picker.body.total, 0);
    assert.doesNotMatch(JSON.stringify(picker.body), /Альфа/);
    assert.doesNotMatch(JSON.stringify(picker.body), new RegExp(CLIENT_ONE));

    const detail = await request(await loadApp())
      .get(`/api/access/delegations/${delegationId}`)
      .set(authHeaders(ropCookie));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.delegation.clients, null);
    assert.equal(detail.body.delegation.clients_access, "restricted");
    assert.doesNotMatch(JSON.stringify(detail.body), /Альфа/);
    assert.doesNotMatch(JSON.stringify(detail.body), new RegExp(CLIENT_ONE));

    const overview = await request(await loadApp())
      .get("/api/access/overview")
      .set(authHeaders(ropCookie));
    assert.equal(overview.status, 200);
    const row = overview.body.delegations.find((item: { id: string }) => item.id === delegationId);
    assert.ok(row);
    assert.equal(row.client_count, null);
    assert.equal(row.clients_access, "restricted");

    const revoke = await accessPost(
      `/api/access/delegations/${delegationId}/revoke`,
      { basis: "rop deny safe revoke", reason: "policy" },
      managerCookie,
    );
    assert.equal(revoke.status, 200);
  });

  it("coordinator caller all_clients deny hides picker and delegation composition", async () => {
    const coordinator = await createTestUser({
      databaseUrl,
      email: "coord-deny@example.com",
      password: TEST_PASSWORD,
      fullName: "Coord Deny",
      role: "coordinator",
    });
    const adminCookie = await login("admin@example.com");
    await adminPost(
      "/api/admin/access/coordinator-teams",
      {
        coordinatorUserId: coordinator.id,
        ropUserId,
        basis: "coord caller deny",
      },
      adminCookie,
    );
    const coordCookie = await login("coord-deny@example.com");
    const managerCookie = await login("manager-a@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE, CLIENT_THREE],
        startsAt,
        endsAt,
        submit: true,
        basis: "coord caller deny composition",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: coordinator.id,
        scopeType: "all_clients",
        reason: "coord global deny",
        basis: "test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const picker = await request(await loadApp())
      .get(`/api/access/delegators/${managerAUserId}/clients?page=1&pageSize=10`)
      .set(authHeaders(coordCookie));
    assert.equal(picker.status, 200);
    assert.deepEqual(picker.body.items, []);
    assert.equal(picker.body.total, 0);
    assert.doesNotMatch(JSON.stringify(picker.body), /Альфа/);
    assert.doesNotMatch(JSON.stringify(picker.body), /Gamma/);

    const detail = await request(await loadApp())
      .get(`/api/access/delegations/${delegationId}`)
      .set(authHeaders(coordCookie));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.delegation.clients, null);
    assert.equal(detail.body.delegation.clients_access, "restricted");
    assert.doesNotMatch(JSON.stringify(detail.body), /Альфа/);
    assert.doesNotMatch(JSON.stringify(detail.body), new RegExp(CLIENT_ONE));
    assert.doesNotMatch(JSON.stringify(detail.body), /Gamma/);

    const overview = await request(await loadApp())
      .get("/api/access/overview")
      .set(authHeaders(coordCookie));
    assert.equal(overview.status, 200);
    const row = overview.body.delegations.find((item: { id: string }) => item.id === delegationId);
    assert.ok(row);
    assert.equal(row.client_count, null);
    assert.equal(row.clients_access, "restricted");

    const revoke = await accessPost(
      `/api/access/delegations/${delegationId}/revoke`,
      { basis: "coord deny safe revoke", reason: "policy" },
      managerCookie,
    );
    assert.equal(revoke.status, 200);
  });

  it("ROP caller single client deny hides composition without leaking denied client", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const adminCookie = await login("admin@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE, CLIENT_THREE],
        startsAt,
        endsAt,
        submit: true,
        basis: "rop partial caller deny",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const denial = await adminPost(
      "/api/admin/access/denials",
      {
        userId: ropUserId,
        scopeType: "client",
        objectId: CLIENT_ONE,
        reason: "rop hide alpha",
        basis: "test",
      },
      adminCookie,
    );
    assert.equal(denial.status, 201);

    const detail = await request(await loadApp())
      .get(`/api/access/delegations/${delegationId}`)
      .set(authHeaders(ropCookie));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.delegation.clients, null);
    assert.equal(detail.body.delegation.clients_access, "restricted");
    assert.doesNotMatch(JSON.stringify(detail.body), /Альфа/);
    assert.doesNotMatch(JSON.stringify(detail.body), new RegExp(CLIENT_ONE));
    assert.doesNotMatch(JSON.stringify(detail.body), /Gamma/);
  });

  it("revoked employee link blocks delegation client composition read", async () => {
    const managerCookie = await login("manager-a@example.com");
    const adminCookie = await login("admin@example.com");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();

    const create = await accessPost(
      "/api/access/delegations",
      {
        assistantUserId,
        clientGuids: [CLIENT_ONE],
        startsAt,
        endsAt,
        submit: false,
        basis: "link revoke leak test",
      },
      managerCookie,
    );
    assert.equal(create.status, 201);
    const delegationId = create.body.id;

    const overviewBefore = await request(await loadApp())
      .get("/api/admin/access/overview")
      .set(authHeaders(adminCookie));
    const link = overviewBefore.body.links.find(
      (row: { user_id: string; revoked_at: string | null }) =>
        row.user_id === managerAUserId && !row.revoked_at,
    );
    assert.ok(link);
    const revokeLink = await adminPost(
      `/api/admin/access/employee-links/${link.id}/revoke`,
      { basis: "revoke link", reason: "rotation" },
      adminCookie,
    );
    assert.equal(revokeLink.status, 200);

    const clientsApi = await request(await loadApp())
      .get("/api/clients")
      .set(authHeaders(managerCookie));
    assert.equal(clientsApi.status, 403);

    const detail = await request(await loadApp())
      .get(`/api/access/delegations/${delegationId}`)
      .set(authHeaders(managerCookie));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.delegation.clients, null);
    assert.equal(detail.body.delegation.clients_access, "restricted");
    assert.doesNotMatch(JSON.stringify(detail.body), /Альфа/);
  });
});
