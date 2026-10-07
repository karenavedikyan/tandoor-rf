import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ONEC_TEAM_UNDEFINED_KEY } from "../../src/clients/org/onec-teams-repository";
import { ORG_DIRECTOR_EMPLOYEE_GUID } from "../../src/clients/org/constants";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { insertSuccessfulImportRun } from "../helpers/clients-db-fixtures";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";
let adminUserId = "";
let managerUserId = "";

const DIRECTOR = ORG_DIRECTOR_EMPLOYEE_GUID;
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEAM_SHARED_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM_SHARED_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TEAM_CONFLICT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MANAGER_LINKED = "11111111-1111-4111-8111-111111111111";
const MANAGER_NO_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const MANAGER_NO_TEAM = "33333333-3333-4333-8333-333333333333";
const ROP_EMPLOYEE = "44444444-4444-4444-8444-444444444444";
const SAME_NAME_A = "66666666-6666-4666-8666-666666666666";
const SAME_NAME_B = "77777777-7777-4777-8777-777777777777";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
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

async function upsertRosterRow(input: {
  guid: string;
  name: string;
  post: string;
  teamGuid?: string | null;
  teamName?: string | null;
}): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_wholesale_employee_roster (
        guid_manager, name_manager, post, guid_team, name_team, raw_json
      )
      VALUES ($1::uuid, $2, $3, $4::uuid, $5, '{}'::jsonb)
      ON CONFLICT (guid_manager) DO UPDATE SET
        name_manager = EXCLUDED.name_manager,
        post = EXCLUDED.post,
        guid_team = EXCLUDED.guid_team,
        name_team = EXCLUDED.name_team
    `,
    [input.guid, input.name, input.post, input.teamGuid ?? null, input.teamName ?? null],
  );
  await pool.end();
}

async function seedRoster(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
      VALUES (1, $1, 8)
      ON CONFLICT (id) DO UPDATE SET employee_count = 8, source_sha256 = EXCLUDED.source_sha256
    `,
    ["b".repeat(64)],
  );
  await pool.end();

  await upsertRosterRow({
    guid: DIRECTOR,
    name: "Гончаренко Дмитрий",
    post: "Директор",
    teamGuid: TEAM_A,
    teamName: "Team Alpha",
  });
  await upsertRosterRow({
    guid: MANAGER_LINKED,
    name: "Linked Manager",
    post: "Менеджер",
    teamGuid: TEAM_A,
    teamName: "Team Alpha",
  });
  await upsertRosterRow({
    guid: MANAGER_NO_ACCOUNT,
    name: "No Account Manager",
    post: "Менеджер",
    teamGuid: TEAM_B,
    teamName: "Team Beta",
  });
  await upsertRosterRow({
    guid: MANAGER_NO_TEAM,
    name: "No Team Manager",
    post: "Менеджер",
    teamGuid: null,
    teamName: null,
  });
  await upsertRosterRow({
    guid: ROP_EMPLOYEE,
    name: "ROP In Team",
    post: "Руководитель отдела продаж",
    teamGuid: TEAM_A,
    teamName: "Team Alpha",
  });
  await upsertRosterRow({
    guid: SAME_NAME_A,
    name: "Same Name A",
    post: "Менеджер",
    teamGuid: TEAM_SHARED_A,
    teamName: "Shared Name",
  });
  await upsertRosterRow({
    guid: SAME_NAME_B,
    name: "Same Name B",
    post: "Менеджер",
    teamGuid: TEAM_SHARED_B,
    teamName: "Shared Name",
  });
  await upsertRosterRow({
    guid: "55555555-5555-4555-8555-555555555555",
    name: "Conflict Name One",
    post: "Менеджер",
    teamGuid: TEAM_CONFLICT,
    teamName: "Name One",
  });
  await upsertRosterRow({
    guid: "88888888-8888-4888-8888-888888888888",
    name: "Conflict Name Two",
    post: "Менеджер",
    teamGuid: TEAM_CONFLICT,
    teamName: "Name Two",
  });
}

describe("clients onec teams integration", { concurrency: false }, () => {
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

    const directorUser = await createTestUser({
      databaseUrl,
      email: "director@example.com",
      password: TEST_PASSWORD,
      fullName: "Director User",
      role: "director",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: directorUser.id,
      employeeId: DIRECTOR,
      confirmedByUserId: adminUserId,
    });

    const managerUser = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    managerUserId = managerUser.id;
    await linkUserToEmployee({
      databaseUrl,
      userId: managerUser.id,
      employeeId: MANAGER_LINKED,
      confirmedByUserId: adminUserId,
    });

    const ropUser = await createTestUser({
      databaseUrl,
      email: "rop@example.com",
      password: TEST_PASSWORD,
      fullName: "ROP User",
      role: "rop",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: ropUser.id,
      employeeId: ROP_EMPLOYEE,
      confirmedByUserId: adminUserId,
    });

    await seedRoster();
    await insertSuccessfulImportRun(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("returns separate groups for same name with different guid_team", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const shared = (res.body.allGroups as Array<{ teamGuid: string | null; displayName: string }>).filter(
      (group) => group.displayName === "Shared Name",
    );
    assert.equal(shared.length, 2);
    assert.ok(shared.some((group) => group.teamGuid === TEAM_SHARED_A));
    assert.ok(shared.some((group) => group.teamGuid === TEAM_SHARED_B));
  });

  it("flags conflicting names for one guid_team", async () => {
    const cookie = await login("director@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const conflict = (res.body.allGroups as Array<{ teamGuid: string | null; nameStatus: string }>).find(
      (group) => group.teamGuid === TEAM_CONFLICT,
    );
    assert.equal(conflict?.nameStatus, "needs_clarification");
  });

  it("includes employees without account and without team bucket", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(cookie));
    assert.equal(res.status, 200);

    const teamBeta = (res.body.groups as Array<{ teamGuid: string | null; members: Array<{ employeeGuid: string; hasLinkedAccount: boolean }> }>).find(
      (group) => group.teamGuid === TEAM_B,
    );
    const noAccount = teamBeta?.members.find((member) => member.employeeGuid === MANAGER_NO_ACCOUNT);
    assert.equal(noAccount?.hasLinkedAccount, false);

    const undefinedGroup = (res.body.allGroups as Array<{ teamGuid: string | null }>).find(
      (group) => group.teamGuid === null,
    );
    assert.ok(undefinedGroup);
    const undefinedMembers = (res.body.groups as Array<{ teamGuid: string | null; members: Array<{ employeeGuid: string }> }>).find(
      (group) => group.teamGuid === null,
    )?.members;
    assert.ok(undefinedMembers?.some((member) => member.employeeGuid === MANAGER_NO_TEAM));
  });

  it("shows director once in team membership and separately in overview", async () => {
    const cookie = await login("director@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.director?.employeeGuid, DIRECTOR);
    const teamAlpha = (res.body.groups as Array<{ teamGuid: string | null; members: Array<{ employeeGuid: string }> }>).find(
      (group) => group.teamGuid === TEAM_A,
    );
    const directorRows = (teamAlpha?.members ?? []).filter((member) => member.employeeGuid === DIRECTOR);
    assert.equal(directorRows.length, 1);
  });

  it("applies selected group and search as AND", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/org-structure/onec-teams?onecTeam=${TEAM_A}&teamQ=linked`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.groups.length, 1);
    assert.equal(res.body.groups[0].teamGuid, TEAM_A);
    assert.equal(res.body.groups[0].members.length, 1);
    assert.equal(res.body.groups[0].members[0].employeeGuid, MANAGER_LINKED);
  });

  it("rejects onec teams for manager and rop roles", async () => {
    const app = await loadApp();
    const managerCookie = await login("manager@example.com");
    const ropCookie = await login("rop@example.com");
    const managerRes = await request(app)
      .get("/api/clients/org-structure/onec-teams")
      .set(authHeaders(managerCookie));
    const ropRes = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(ropCookie));
    assert.equal(managerRes.status, 403);
    assert.equal(ropRes.status, 403);
  });

  it("returns 503 when roster source is not loaded", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`UPDATE onec_wholesale_roster_state SET employee_count = 0 WHERE id = 1`);
    await pool.end();

    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app).get("/api/clients/org-structure/onec-teams").set(authHeaders(cookie));
    assert.equal(res.status, 503);
  });

  it("filters undefined bucket by token", async () => {
    const cookie = await login("admin@example.com");
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/clients/org-structure/onec-teams?onecTeam=${ONEC_TEAM_UNDEFINED_KEY}`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.groups.length, 1);
    assert.equal(res.body.groups[0].teamGuid, null);
  });

  it("blocks onec teams in admin preview of manager effective user", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(authHeaders(adminCookie))
      .send({ targetUserId: managerUserId });
    assert.equal(start.status, 200);

    const previewRes = await request(app)
      .get("/api/clients/org-structure/onec-teams")
      .set(authHeaders(adminCookie));
    assert.equal(previewRes.status, 403);

    await request(app).post("/api/admin/access/preview/stop").set(authHeaders(adminCookie)).send({});
  });
});
