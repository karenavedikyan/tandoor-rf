import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  ORG_DIRECTOR_EMPLOYEE_GUID,
  ROSTER_ASSISTANT_MEMBER_POST_LABEL,
  ROSTER_ASSISTANTS_HEAD_POST_LABEL,
} from "../../src/clients/org/constants";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";
let adminUserId = "";

const ROA_HEAD = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const ASSISTANT_ONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const ASSISTANT_NO_ACCOUNT = "ffffffff-ffff-4fff-8fff-ffffffff0003";
const MARKETING = "99999999-9999-4999-8999-999999999999";

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

async function seedAssistantsRoster(rows: Array<[string, string, string]>, employeeCount: number): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
      VALUES (1, $1, $2)
      ON CONFLICT (id) DO UPDATE SET employee_count = EXCLUDED.employee_count
    `,
    ["c".repeat(64), employeeCount],
  );
  for (const [guid, name, post] of rows) {
    await pool.query(
      `
        INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
        VALUES ($1::uuid, $2, $3, '{}'::jsonb)
        ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post
      `,
      [guid, name, post],
    );
  }
  await pool.end();
}

describe("clients org-structure assistants department", () => {
  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID = ROA_HEAD;
    delete process.env.TANDOOR_ORG_ASSISTANTS_HEAD_IN_TEAM;

    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    adminUserId = admin.id;
    const directorUser = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: directorUser.id,
      employeeId: ORG_DIRECTOR_EMPLOYEE_GUID,
      confirmedByUserId: admin.id,
    });
    await createTestUser({
      databaseUrl,
      email: "rop@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP",
      role: "rop",
    });
    const assistantUser = await createTestUser({
      databaseUrl,
      email: "roa@example.com",
      password: TEST_PASSWORD,
      fullName: "ROA User",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: assistantUser.id,
      employeeId: ROA_HEAD,
      confirmedByUserId: admin.id,
    });
  });

  beforeEach(async () => {
    process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID = ROA_HEAD;
    delete process.env.TANDOOR_ORG_ASSISTANTS_HEAD_IN_TEAM;
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`DELETE FROM onec_wholesale_employee_roster`);
    await pool.query(`DELETE FROM onec_wholesale_roster_state`);
    await pool.end();
  });

  after(async () => {
    delete process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID;
    delete process.env.TANDOOR_ORG_ASSISTANTS_HEAD_IN_TEAM;
    await closePool();
  });

  it("returns dual-role ROA and unique member count for director", async () => {
    await seedAssistantsRoster(
      [
        [ROA_HEAD, "ROA Head", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
        [ASSISTANT_ONE, "Assistant One", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
        [ASSISTANT_NO_ACCOUNT, "Assistant No Account", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
        [MARKETING, "Marketing", "Маркетолог"],
      ],
      4,
    );

    const cookie = await login("director@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const dept = res.body.assistantsDepartment;
    assert.equal(dept.loadState, "ready");
    assert.equal(dept.head.employeeGuid, ROA_HEAD);
    assert.equal(dept.head.isAlsoAssistant, true);
    assert.equal(dept.uniqueMemberCount, 3);
    const roaMember = dept.members.find((item: { employeeGuid: string }) => item.employeeGuid === ROA_HEAD);
    assert.deepEqual(roaMember.roles.sort(), ["assistant", "roa"]);
    assert.equal(
      dept.members.filter((item: { employeeGuid: string }) => item.employeeGuid === ROA_HEAD).length,
      1,
    );
    const noAccount = dept.members.find(
      (item: { employeeGuid: string }) => item.employeeGuid === ASSISTANT_NO_ACCOUNT,
    );
    assert.equal(noAccount.hasLinkedAccount, false);
    assert.ok(!res.body.undefinedTeam.some((item: { employeeGuid: string }) => item.employeeGuid === ROA_HEAD));
    assert.ok(res.body.undefinedTeam.some((item: { name: string }) => item.name.includes("Marketing")));
  });

  it("reports unconfigured assistants department without zero-member masquerade", async () => {
    delete process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID;
    await seedAssistantsRoster([[ASSISTANT_ONE, "Assistant One", ROSTER_ASSISTANT_MEMBER_POST_LABEL]], 1);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.assistantsDepartment.loadState, "unconfigured");
    assert.equal(res.body.assistantsDepartment.head, null);
    assert.equal(res.body.assistantsDepartment.uniqueMemberCount, 0);
  });

  it("reports roster_missing when head env is set but roster is empty", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.assistantsDepartment.loadState, "roster_missing");
    assert.equal(res.body.assistantsDepartment.head.employeeGuid, ROA_HEAD);
    assert.equal(res.body.assistantsDepartment.uniqueMemberCount, 0);
  });

  it("reports empty confirmed team separately from unconfigured", async () => {
    await seedAssistantsRoster([[ROA_HEAD, "ROA Head", ROSTER_ASSISTANTS_HEAD_POST_LABEL]], 1);

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.assistantsDepartment.loadState, "empty");
    assert.equal(res.body.assistantsDepartment.uniqueMemberCount, 0);
    assert.equal(res.body.assistantsDepartment.head.isAlsoAssistant, false);
  });

  it("hides assistants department from ROP and during admin preview", async () => {
    await seedAssistantsRoster(
      [
        [ROA_HEAD, "ROA Head", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
        [ASSISTANT_ONE, "Assistant One", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
      ],
      2,
    );

    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop-assistants@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP Assistants",
      role: "rop",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropUser.id,
      employeeId: "11a0c069-11bc-11ea-80ec-00155d0a0a4e",
      confirmedByUserId: adminUserId,
    });

    const ropCookie = await login("rop-assistants@example.com");
    const app = await loadApp();
    const ropRes = await request(app).get("/api/clients/org-structure").set(authHeaders(ropCookie));
    assert.equal(ropRes.status, 200);
    assert.equal(ropRes.body.assistantsDepartment, null);

    const adminCookie = await login("admin@example.com");
    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager-preview@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Preview",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUser.id,
      employeeId: ASSISTANT_ONE,
      confirmedByUserId: adminUserId,
    });
    const startPreview = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ userId: managerUser.id });
    assert.equal(startPreview.status, 200);

    const previewRes = await request(app).get("/api/clients/org-structure").set(authHeaders(adminCookie));
    assert.equal(previewRes.status, 403);
  });

  it("discovers head from roster post when env guid is absent", async () => {
    delete process.env.TANDOOR_ORG_ASSISTANTS_HEAD_EMPLOYEE_GUID;
    await seedAssistantsRoster(
      [
        [ROA_HEAD, "ROA Head", ROSTER_ASSISTANTS_HEAD_POST_LABEL],
        [ASSISTANT_ONE, "Assistant One", ROSTER_ASSISTANT_MEMBER_POST_LABEL],
      ],
      2,
    );

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.assistantsDepartment.head.employeeGuid, ROA_HEAD);
    assert.equal(res.body.assistantsDepartment.loadState, "ready");
    assert.equal(res.body.assistantsDepartment.uniqueMemberCount, 1);
  });
});
