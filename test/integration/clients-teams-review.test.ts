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
  addRopTeamMember,
  denyClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
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
const OUTSIDE_ROSTER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DUPLICATE_NAME_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DUPLICATE_NAME_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const CLIENT_THREE = "66666666-6666-4666-8666-666666666666";
const CLIENT_ROP_OWN = "88888888-8888-4888-8888-888888888888";
const CLIENT_OUTSIDE = "99999999-9999-4999-8999-999999999999";

let adminUserId = "";
let managerAUserId = "";
let managerBUserId = "";
let ropUserId = "";

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

async function adminPost(path: string, body: unknown, adminCookie: string) {
  const app = await loadApp();
  return request(app).post(path).set(authHeaders(adminCookie)).send(body);
}

describe("clients teams and review integration", { concurrency: false }, () => {
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

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Альфа Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "Москва",
        telephone: ["+79990001122"],
        manager_roster_state: "in_wholesale_roster",
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Бета Клиент",
        guid_manager: MANAGER_B,
        name_manager: "Менеджер Петров",
        address: "Казань",
        telephone: [],
        manager_roster_state: "in_wholesale_roster",
      },
      {
        guid_client: CLIENT_THREE,
        name_client: "Gamma Клиент",
        guid_manager: MANAGER_A,
        name_manager: "Менеджер Иванов",
        address: "СПб",
        telephone: [],
        manager_roster_state: "in_wholesale_roster",
      },
      {
        guid_client: CLIENT_ROP_OWN,
        name_client: "ROP Own Client",
        guid_manager: ROP_EMPLOYEE,
        name_manager: "ROP User",
        address: "Тверь",
        telephone: [],
        manager_roster_state: "in_wholesale_roster",
      },
      {
        guid_client: CLIENT_OUTSIDE,
        name_client: "Outside Roster Client",
        guid_manager: OUTSIDE_ROSTER,
        name_manager: "Вне ОПТ",
        address: "Омск",
        telephone: [],
        manager_roster_state: "outside_wholesale_roster",
      },
      {
        guid_client: DUPLICATE_NAME_A,
        name_client: "Dup Name Client A",
        guid_manager: DUPLICATE_NAME_A,
        name_manager: "Одинаковое ФИО",
        address: "A",
        telephone: [],
        manager_roster_state: "in_wholesale_roster",
      },
      {
        guid_client: DUPLICATE_NAME_B,
        name_client: "Dup Name Client B",
        guid_manager: DUPLICATE_NAME_B,
        name_manager: "Одинаковое ФИО",
        address: "B",
        telephone: [],
        manager_roster_state: "in_wholesale_roster",
      },
    ]);
    await insertSuccessfulImportRun(databaseUrl, { recordCount: 7 });

    const adminCookie = await login("admin@example.com");
    for (const [userId, employeeId] of [
      [managerAUserId, MANAGER_A],
      [managerBUserId, MANAGER_B],
      [ropUserId, ROP_EMPLOYEE],
    ] as const) {
      const link = await adminPost(
        "/api/admin/access/employee-links",
        { userId, employeeId, basis: "integration setup" },
        adminCookie,
      );
      assert.equal(link.status, 201);
    }

    const team = await adminPost(
      "/api/admin/access/rop-teams",
      { ropUserId, memberUserId: managerAUserId, basis: "integration team" },
      adminCookie,
    );
    assert.equal(team.status, 201);

  });

  after(async () => {
    await closePool();
  });

  it("admin navigates ROP → manager → clients with breadcrumbs params", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const rops = await request(app).get("/api/clients/teams").set(authHeaders(adminCookie));
    assert.equal(rops.status, 200);
    const rop = rops.body.items.find((item: { ropUserId: string }) => item.ropUserId === ropUserId);
    assert.ok(rop);
    assert.equal(rop.managerCount, 1);
    assert.equal(rop.uniqueClientCount, 3);

    const managers = await request(app)
      .get(`/api/clients/teams/${ropUserId}/managers`)
      .set(authHeaders(adminCookie));
    assert.equal(managers.status, 200);
    const teamManager = managers.body.items.find(
      (item: { kind: string; employeeGuid: string }) =>
        item.kind === "team_member" && item.employeeGuid === MANAGER_A,
    );
    assert.ok(teamManager);
    assert.equal(teamManager.clientCount, 2);
    const ropOwn = managers.body.items.find((item: { kind: string }) => item.kind === "rop_own");
    assert.ok(ropOwn);
    assert.equal(ropOwn.clientCount, 1);

    const clients = await request(app)
      .get(`/api/clients?view=teams&rop=${ropUserId}&manager=${MANAGER_A}`)
      .set(authHeaders(adminCookie));
    assert.equal(clients.status, 200);
    assert.equal(clients.body.total, 2);
    assert.ok(clients.body.items.every((item: { guid: string }) => [CLIENT_ONE, CLIENT_THREE].includes(item.guid)));
  });

  it("flags unassigned categories and distinct GUIDs for duplicate names", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const teamRows = await pool.query<{ member_user_id: string; employee_id: string }>(
      `
        SELECT rtm.member_user_id::text, uoel.employee_id::text
        FROM rop_team_members rtm
        LEFT JOIN user_onec_employee_links uoel
          ON uoel.user_id = rtm.member_user_id AND uoel.revoked_at IS NULL
        WHERE rtm.revoked_at IS NULL
      `,
    );
    await pool.end();
    assert.ok(
      teamRows.rows.some((row) => row.employee_id?.toLowerCase() === MANAGER_A),
      `team setup missing manager A: ${JSON.stringify(teamRows.rows)}`,
    );
    assert.ok(
      !teamRows.rows.some((row) => row.employee_id?.toLowerCase() === MANAGER_B),
      `manager B must not be in team: ${JSON.stringify(teamRows.rows)}`,
    );

    const summary = await request(app)
      .get("/api/clients/unassigned/summary")
      .set(authHeaders(adminCookie));
    assert.equal(summary.status, 200);
    assert.match(summary.body.limitationNote, /справочник/i);

    const withoutTeam = summary.body.employees.filter(
      (item: { category: string }) => item.category === "opt_without_rop_team",
    );
    assert.ok(
      withoutTeam.some((item: { employeeGuid: string }) => item.employeeGuid.toLowerCase() === MANAGER_B),
      JSON.stringify(summary.body.categories),
    );

    const withoutAccount = summary.body.employees.filter(
      (item: { category: string }) => item.category === "opt_without_account_link",
    );
    assert.ok(withoutAccount.length >= 1, JSON.stringify(summary.body.categories));

    const dupGuids = summary.body.employees.filter(
      (item: { name: string }) => item.name === "Одинаковое ФИО",
    );
    assert.equal(dupGuids.length, 2);
    assert.notEqual(dupGuids[0].employeeGuid, dupGuids[1].employeeGuid);
    assert.notEqual(dupGuids[0].shortId, dupGuids[1].shortId);
  });

  it("denies foreign ROP team and manager drill-down", async () => {
    const ropCookie = await login("rop@example.com");
    const app = await loadApp();

    const foreignManagers = await request(app)
      .get(`/api/clients/teams/${adminUserId}/managers`)
      .set(authHeaders(ropCookie));
    assert.equal(foreignManagers.status, 403);

    const foreignClients = await request(app)
      .get(`/api/clients?view=teams&rop=${ropUserId}&manager=${MANAGER_B}`)
      .set(authHeaders(ropCookie));
    assert.equal(foreignClients.status, 403);
  });

  it("saves review with history and detects stale after import change", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const save = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "propose_transfer",
        proposedManagerGuid: MANAGER_B,
        comment: "Предложена передача",
        expectedVersion: null,
      });
    assert.equal(save.status, 200);
    assert.equal(save.body.review.transferStatus, "proposed");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        UPDATE onec_clients
        SET guid_manager = $2::uuid, name_manager = 'Менеджер Петров', source_sha256 = 'changed-sha'
        WHERE guid_client = $1::uuid
      `,
      [CLIENT_ONE, MANAGER_B],
    );
    await pool.end();

    const stale = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie));
    assert.equal(stale.status, 200);
    assert.equal(stale.body.review.isStale, true);
    assert.match(stale.body.review.staleReason ?? "", /импорт/i);

    const history = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/review/history`)
      .set(authHeaders(adminCookie));
    assert.equal(history.status, 200);
    assert.ok(history.body.items.length >= 1);
  });

  it("review conflict on concurrent version and manager-only review denial", async () => {
    const adminCookie = await login("admin@example.com");
    const managerCookie = await login("manager-a@example.com");
    const app = await loadApp();

    const first = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", expectedVersion: null });
    assert.equal(first.status, 200);

    const conflict = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "completed", expectedVersion: 0 });
    assert.equal(conflict.status, 409);

    const managerSave = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(managerCookie))
      .send({ reviewState: "completed", expectedVersion: first.body.review.version });
    assert.equal(managerSave.status, 403);

    const managerReviewList = await request(app)
      .get("/api/clients?view=review")
      .set(authHeaders(managerCookie));
    assert.equal(managerReviewList.status, 403);
  });

  it("combines review filters with search without SQL placeholder errors", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", expectedVersion: null });

    const filtered = await request(app)
      .get("/api/clients?view=review&q=%D0%90%D0%BB%D1%8C%D1%84%D0%B0&reviewState=in_progress")
      .set(authHeaders(adminCookie));
    assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.items[0].guid, CLIENT_ONE);
  });

  it("limits teams view by ROP without manager filter", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const scoped = await request(app)
      .get(`/api/clients?view=teams&rop=${ropUserId}`)
      .set(authHeaders(adminCookie));
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.total, 3);
    assert.equal(scoped.body.items.length, 3);
  });

  it("aligns team counters with access denials", async () => {
    const adminCookie = await login("admin@example.com");
    const ropCookie = await login("rop@example.com");
    const app = await loadApp();

    await denyClientAccess({
      databaseUrl,
      userId: ropUserId,
      scopeType: "client",
      objectId: CLIENT_ONE,
      deniedByUserId: adminUserId,
    });

    const managers = await request(app)
      .get(`/api/clients/teams/${ropUserId}/managers`)
      .set(authHeaders(ropCookie));
    assert.equal(managers.status, 200);
    const teamManager = managers.body.items.find(
      (item: { employeeGuid: string }) => item.employeeGuid === MANAGER_A,
    );
    assert.ok(teamManager);
    assert.equal(teamManager.clientCount, 1);

    const list = await request(app)
      .get(`/api/clients?view=teams&rop=${ropUserId}&manager=${MANAGER_A}`)
      .set(authHeaders(ropCookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].guid, CLIENT_THREE);
  });

  it("rejects null expectedVersion overwrite and same-manager transfer confirmation", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const created = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "propose_transfer",
        proposedManagerGuid: MANAGER_B,
        expectedVersion: null,
      });
    assert.equal(created.status, 200);

    const overwrite = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({ reviewState: "in_progress", expectedVersion: null });
    assert.equal(overwrite.status, 409);

    const transferProposed = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "propose_transfer",
        proposedManagerGuid: MANAGER_A,
        expectedVersion: null,
      });
    assert.equal(transferProposed.status, 200);
    assert.equal(transferProposed.body.review.transferStatus, "proposed");

    const sameManager = await request(app)
      .put(`/api/clients/${CLIENT_THREE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "propose_transfer",
        proposedManagerGuid: MANAGER_A,
        expectedVersion: null,
      });
    assert.equal(sameManager.status, 400);
  });

  it("recheck clears stale state after import and preserves history", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const initial = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "Первичное основание",
        expectedVersion: null,
      });
    assert.equal(initial.status, 200);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE onec_clients SET address = 'Новый адрес' WHERE guid_client = $1::uuid`,
      [CLIENT_ONE],
    );
    await pool.end();

    const stale = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie));
    assert.equal(stale.status, 200);
    assert.equal(stale.body.review.reviewState, "needs_recheck");
    assert.equal(stale.body.review.isStale, true);

    const recheck = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "Повторное подтверждение после импорта",
        expectedVersion: stale.body.review.version,
        recheckConfirmed: true,
      });
    assert.equal(recheck.status, 200);
    assert.equal(recheck.body.review.isStale, false);
    assert.equal(recheck.body.review.reviewState, "completed");

    const history = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/review/history`)
      .set(authHeaders(adminCookie));
    assert.equal(history.status, 200);
    assert.ok(history.body.items.some((item: { changeType: string }) => item.changeType === "recheck"));
  });

  it("denies admin review data to manager via review API", async () => {
    const managerCookie = await login("manager-a@example.com");
    const app = await loadApp();

    const review = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(managerCookie));
    assert.equal(review.status, 403);
  });

  it("excludes archived baseline clients from working lists", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE onec_clients SET baseline_status = 'archived_baseline' WHERE guid_client = $1::uuid`,
      [CLIENT_THREE],
    );
    await pool.end();

    const list = await request(app)
      .get(`/api/clients?manager=${MANAGER_A}`)
      .set(authHeaders(adminCookie));
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].guid, CLIENT_ONE);
  });

  it("persists review save with admin reviewer, reload, and history", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const dueAt = "2026-10-05T09:00:00.000Z";

    const save = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        comment: "Проверено администратором",
        assignedReviewerUserId: adminUserId,
        dueAt,
        expectedVersion: null,
      });
    assert.equal(save.status, 200);
    assert.equal(save.body.review.assignedReviewerUserId, adminUserId);
    assert.equal(save.body.review.dueAt, dueAt);

    const reload = await request(app)
      .get(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie));
    assert.equal(reload.status, 200);
    assert.equal(reload.body.review.reviewDecision, "confirm_current_manager");
    assert.equal(reload.body.review.assignedReviewerUserId, adminUserId);

    const history = await request(app)
      .get(`/api/clients/${CLIENT_TWO}/review/history`)
      .set(authHeaders(adminCookie));
    assert.equal(history.status, 200);
    assert.ok(history.body.items.some((item: { changeType: string }) => item.changeType === "create"));
  });

  it("rejects employee GUID and non-admin users as reviewer", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const employeeGuidAttempt = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "in_progress",
        assignedReviewerUserId: MANAGER_A,
        expectedVersion: null,
      });
    assert.equal(employeeGuidAttempt.status, 400);
    assert.match(employeeGuidAttempt.body.error.message, /администратор/i);

    const managerAttempt = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "in_progress",
        assignedReviewerUserId: managerAUserId,
        expectedVersion: null,
      });
    assert.equal(managerAttempt.status, 400);

    const ropAttempt = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "in_progress",
        assignedReviewerUserId: ropUserId,
        expectedVersion: null,
      });
    assert.equal(ropAttempt.status, 400);
  });

  it("denies review list filters to manager and ROP without leaking review metadata", async () => {
    const managerCookie = await login("manager-a@example.com");
    const ropCookie = await login("rop@example.com");
    const app = await loadApp();

    const cases = [
      "/api/clients?view=all&reviewState=any&reviewDecision=propose_transfer",
      "/api/clients?view=teams&reviewState=needs_recheck",
      "/api/clients?view=all&reviewState=in_progress",
      "/api/clients?view=teams&reviewDecision=confirm_current_manager",
    ];
    for (const path of cases) {
      const managerRes = await request(app).get(path).set(authHeaders(managerCookie));
      assert.equal(managerRes.status, 403, path);
      const ropRes = await request(app).get(path).set(authHeaders(ropCookie));
      assert.equal(ropRes.status, 403, path);
    }

    const normalList = await request(app)
      .get(`/api/clients?manager=${MANAGER_A}`)
      .set(authHeaders(managerCookie));
    assert.equal(normalList.status, 200);
    assert.ok(normalList.body.items.length >= 1);
    assert.ok(
      normalList.body.items.every((item: { review?: unknown }) => item.review === undefined),
    );
  });

  it("keeps stale awaiting_1c_fix review in needs_recheck queue and supports recheck", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    const save = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "awaiting_1c_fix",
        reviewDecision: "propose_transfer",
        proposedManagerGuid: MANAGER_B,
        expectedVersion: null,
      });
    assert.equal(save.status, 200);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`UPDATE onec_clients SET address = 'Новый адрес для очереди' WHERE guid_client = $1::uuid`, [
      CLIENT_ONE,
    ]);
    await pool.end();

    const awaitingQueue = await request(app)
      .get("/api/clients?view=review&reviewState=awaiting_1c_fix")
      .set(authHeaders(adminCookie));
    assert.equal(awaitingQueue.status, 200);
    assert.equal(awaitingQueue.body.total, 0);

    const recheckQueue = await request(app)
      .get("/api/clients?view=review&reviewState=needs_recheck")
      .set(authHeaders(adminCookie));
    assert.equal(recheckQueue.status, 200);
    assert.ok(recheckQueue.body.items.some((item: { guid: string }) => item.guid === CLIENT_ONE));
    const queued = recheckQueue.body.items.find((item: { guid: string }) => item.guid === CLIENT_ONE);
    assert.equal(queued.review.state, "needs_recheck");
    assert.equal(queued.review.isStale, true);

    const staleDetail = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie));
    assert.equal(staleDetail.body.review.isStale, true);
    assert.equal(staleDetail.body.review.reviewState, "needs_recheck");

    const recheck = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "awaiting_1c_fix",
        reviewDecision: "propose_transfer",
        proposedManagerGuid: MANAGER_B,
        expectedVersion: staleDetail.body.review.version,
        recheckConfirmed: true,
      });
    assert.equal(recheck.status, 200);
    assert.equal(recheck.body.review.isStale, false);

    const history = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/review/history`)
      .set(authHeaders(adminCookie));
    assert.ok(history.body.items.some((item: { changeType: string }) => item.changeType === "recheck"));
  });

  it("does not mark review stale when only source SHA changes", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();

    await request(app)
      .put(`/api/clients/${CLIENT_THREE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "in_progress",
        expectedVersion: null,
      });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE onec_clients SET source_sha256 = $2 WHERE guid_client = $1::uuid`,
      [CLIENT_THREE, "f".repeat(64)],
    );
    await pool.end();

    const detail = await request(app)
      .get(`/api/clients/${CLIENT_THREE}/review`)
      .set(authHeaders(adminCookie));
    assert.equal(detail.body.review.isStale, false);

    const list = await request(app)
      .get("/api/clients?view=review&reviewState=in_progress")
      .set(authHeaders(adminCookie));
    assert.ok(list.body.items.some((item: { guid: string }) => item.guid === CLIENT_THREE));
    const listed = list.body.items.find((item: { guid: string }) => item.guid === CLIENT_THREE);
    assert.equal(listed.review.isStale, false);
  });

  it("aligns list and detail stale state for unresolved pending holding", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const pendingHolding = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `
        UPDATE onec_clients
        SET guid_holding = NULL,
            name_holding = '',
            guid_holding_pending = $2::uuid,
            holding_link_state = 'unresolved'
        WHERE guid_client = $1::uuid
      `,
      [CLIENT_TWO, pendingHolding],
    );
    await pool.end();

    await request(app)
      .put(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "completed",
        reviewDecision: "confirm_current_manager",
        expectedVersion: null,
      });

    const detail = await request(app)
      .get(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie));
    assert.equal(detail.body.review.isStale, false);

    const completedList = await request(app)
      .get("/api/clients?view=review&reviewState=completed")
      .set(authHeaders(adminCookie));
    const listed = completedList.body.items.find((item: { guid: string }) => item.guid === CLIENT_TWO);
    assert.ok(listed);
    assert.equal(listed.review.isStale, false);
    assert.equal(listed.review.state, "completed");
    assert.equal(listed.holding.linkState, "unresolved");
    assert.equal(listed.holding.pendingId, pendingHolding);

    const pool2 = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool2.query(
      `UPDATE onec_clients SET guid_holding_pending = $2::uuid WHERE guid_client = $1::uuid`,
      [CLIENT_TWO, "ffffffff-ffff-4fff-8fff-ffffffffffff"],
    );
    await pool2.end();

    const staleDetail = await request(app)
      .get(`/api/clients/${CLIENT_TWO}/review`)
      .set(authHeaders(adminCookie));
    assert.equal(staleDetail.body.review.isStale, true);

    const staleList = await request(app)
      .get("/api/clients?view=review&reviewState=needs_recheck")
      .set(authHeaders(adminCookie));
    const staleListed = staleList.body.items.find((item: { guid: string }) => item.guid === CLIENT_TWO);
    assert.ok(staleListed);
    assert.equal(staleListed.review.isStale, true);
    assert.equal(staleListed.review.state, "needs_recheck");
  });

  it("round-trips dueAt through API without drift", async () => {
    const adminCookie = await login("admin@example.com");
    const app = await loadApp();
    const dueAt = "2026-10-05T09:00:00.000Z";

    const save = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "in_progress",
        dueAt,
        expectedVersion: null,
      });
    assert.equal(save.status, 200);
    assert.equal(save.body.review.dueAt, dueAt);

    const resave = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "in_progress",
        dueAt,
        expectedVersion: save.body.review.version,
      });
    assert.equal(resave.status, 200);
    assert.equal(resave.body.review.dueAt, dueAt);

    const cleared = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/review`)
      .set(authHeaders(adminCookie))
      .send({
        reviewState: "in_progress",
        dueAt: null,
        expectedVersion: resave.body.review.version,
      });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.review.dueAt, null);
  });
});

