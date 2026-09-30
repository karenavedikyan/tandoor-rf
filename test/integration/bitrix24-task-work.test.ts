import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import { resetPoolForTests } from "../../src/db/pool";
import { upsertEmployeePortalLink, upsertTaskSnapshot } from "../../src/bitrix24/tasks/repository";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import {
  createDelegationRecord,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import { sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";
import { HOLDING_ONE, linkCardToHolding } from "../helpers/bitrix24-card-fixtures";
import { insertSummaryPublication } from "../helpers/bitrix24-work-fixtures";
import { Pool } from "pg";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const ASSISTANT_EMP = "99999999-9999-4999-8999-999999999999";

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
  const cookie = res.headers["set-cookie"]?.[0] ?? "";
  return cookie.split(";")[0] ?? "";
}

describe("bitrix24 task work integration", { concurrency: false }, () => {
  let databaseUrl = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.BITRIX24_ENABLED = "true";
    process.env.BITRIX24_WEBHOOK_URL = sampleWebhookConfig().webhookBaseUrl;
    process.env.BITRIX24_CACHE_PUBLISH_ENABLED = "true";
    process.env.BITRIX24_CACHE_ACCESS_TTL_MS = "3600000";
    process.env.BITRIX24_PILOT_TASK_IDS = "9001";
    process.env.BITRIX24_PILOT_ALLOWLIST_REQUIRED = "true";
    process.env.BITRIX24_PORTAL_PUBLIC_URL = "https://example.bitrix24.ru";
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin User",
      role: "admin",
    });
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Client One",
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Client Two",
        guid_manager: MANAGER_B,
        name_manager: "Manager B",
      },
    ]);
    await linkCardToHolding(CLIENT_ONE, HOLDING_ONE);
  });

  after(() => {
    delete process.env.BITRIX24_ENABLED;
    delete process.env.BITRIX24_WEBHOOK_URL;
    delete process.env.BITRIX24_CACHE_PUBLISH_ENABLED;
    delete process.env.BITRIX24_CACHE_ACCESS_TTL_MS;
    delete process.env.BITRIX24_PILOT_TASK_IDS;
    delete process.env.BITRIX24_PILOT_ALLOWLIST_REQUIRED;
    delete process.env.BITRIX24_PORTAL_PUBLIC_URL;
  });

  async function seedPublishedTask(input: {
    responsibleBitrixUserId: string;
    responsibleUserId: string;
    briefText?: string;
  }) {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: input.responsibleUserId,
      portalId: config.portalId,
      bitrixUserId: input.responsibleBitrixUserId,
    });
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: input.responsibleBitrixUserId,
      title: "Secret full title",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });
    if (input.briefText) {
      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const admin = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = 'admin@example.com'",
      );
      await pool.end();
      await insertSummaryPublication({
        databaseUrl,
        portalId: config.portalId,
        taskId: "9001",
        objectType: "holding",
        objectGuid: HOLDING_ONE,
        briefText: input.briefText,
        publishedByUserId: admin.rows[0]!.id,
      });
    }
    return config;
  }

  it("returns canonical portal URL only for full task access", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "42",
    });
    await seedPublishedTask({
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
    });
    const app = await loadApp();
    const cookie = await login("manager-a@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.state, "ready");
    assert.equal(res.body.tasks[0]?.accessLevel, "full");
    assert.equal(
      res.body.tasks[0]?.portalUrl,
      "https://example.bitrix24.ru/company/personal/user/42/tasks/task/view/9001/",
    );
  });

  it("shows summary without full title when publication exists for non-responsible viewer", async () => {
    const managerB = await createTestUser({
      databaseUrl,
      email: "manager-b@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager B Viewer",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerB.id,
      employeeId: MANAGER_B,
      confirmedByUserId: managerB.id,
    });
    await grantViewerClientAccess(databaseUrl, managerB.id, CLIENT_ONE);
    await upsertEmployeePortalLink({
      userId: managerB.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "99",
    });
    const responsible = await createTestUser({
      databaseUrl,
      email: "responsible@example.com",
      password: TEST_PASSWORD,
      fullName: "Responsible User",
      role: "manager",
    });
    await seedPublishedTask({
      responsibleBitrixUserId: "42",
      responsibleUserId: responsible.id,
      briefText: "Краткое поручение для команды",
    });
    const app = await loadApp();
    const cookie = await login("manager-b@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.state, "ready");
    assert.equal(res.body.tasks[0]?.accessLevel, "summary");
    assert.equal(res.body.tasks[0]?.briefText, "Краткое поручение для команды");
    assert.equal(res.body.tasks[0]?.title, undefined);
    assert.equal(res.body.tasks[0]?.portalUrl, undefined);
    assert.equal(res.body.tasks[0]?.responsible?.displayName, "Responsible User");
  });

  it("hides unpublished summary from non-responsible viewer", async () => {
    const managerB = await createTestUser({
      databaseUrl,
      email: "manager-b@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager B Viewer",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerB.id,
      employeeId: MANAGER_B,
      confirmedByUserId: managerB.id,
    });
    await grantViewerClientAccess(databaseUrl, managerB.id, CLIENT_ONE);
    await upsertEmployeePortalLink({
      userId: managerB.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "99",
    });
    const responsible = await createTestUser({
      databaseUrl,
      email: "responsible@example.com",
      password: TEST_PASSWORD,
      fullName: "Responsible User",
      role: "manager",
    });
    await seedPublishedTask({
      responsibleBitrixUserId: "42",
      responsibleUserId: responsible.id,
    });
    const app = await loadApp();
    const cookie = await login("manager-b@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.state, "empty");
    assert.equal(res.body.tasks.length, 0);
  });

  it("stores and revokes contact action idempotently for two employees", async () => {
    const managerA = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A Owner",
      role: "manager",
    });
    const managerB = await createTestUser({
      databaseUrl,
      email: "manager-b@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager B Viewer",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerA.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerA.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerB.id,
      employeeId: MANAGER_B,
      confirmedByUserId: managerA.id,
    });
    await grantViewerClientAccess(databaseUrl, managerB.id, CLIENT_ONE);
    await upsertEmployeePortalLink({
      userId: managerA.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "42",
    });
    await upsertEmployeePortalLink({
      userId: managerB.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "99",
    });
    await seedPublishedTask({
      responsibleBitrixUserId: "42",
      responsibleUserId: managerA.id,
      briefText: "Командное поручение",
    });
    const app = await loadApp();
    const cookieA = await login("manager-a@example.com");
    const cookieB = await login("manager-b@example.com");

    const markA = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(cookieA))
      .send({ marked: true, comment: "Связался A" });
    assert.equal(markA.status, 200);
    const markB = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(cookieB))
      .send({ marked: true, comment: "Связался B" });
    assert.equal(markB.status, 200);

    const repeat = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(cookieA))
      .send({ marked: true, comment: "Связался A" });
    assert.equal(repeat.status, 200);

    const tasksA = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookieA));
    assert.equal(tasksA.body.tasks[0]?.contactAction?.comment, "Связался A");

    const tasksB = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookieB));
    assert.equal(tasksB.body.tasks[0]?.contactAction?.comment, "Связался B");

    const revoke = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(cookieA))
      .send({ marked: false });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.marked, false);
  });

  it("rejects contact mutation for foreign client and after delegation ends", async () => {
    const managerA = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    const assistant = await createTestUser({
      databaseUrl,
      email: "assistant@example.com",
      password: TEST_PASSWORD,
      fullName: "Assistant User",
      role: "assistant",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerA.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerA.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: assistant.id,
      employeeId: ASSISTANT_EMP,
      confirmedByUserId: managerA.id,
    });
    await upsertEmployeePortalLink({
      userId: managerA.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "42",
    });
    await upsertEmployeePortalLink({
      userId: assistant.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "77",
    });
    await seedPublishedTask({
      responsibleBitrixUserId: "42",
      responsibleUserId: managerA.id,
      briefText: "Поручение для замещения",
    });
    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerA.id,
      assistantUserId: assistant.id,
      clientGuids: [CLIENT_ONE],
      status: "active",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      approvedByUserId: managerA.id,
    });
    const app = await loadApp();
    const managerCookie = await login("manager-a@example.com");
    const foreign = await request(app)
      .put(`/api/clients/${CLIENT_TWO}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(managerCookie))
      .send({ marked: true });
    assert.equal(foreign.status, 404);

    const assistantCookie = await login("assistant@example.com");
    const active = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(assistantCookie))
      .send({ marked: true });
    assert.equal(active.status, 200);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE delegations SET status = 'expired', ends_at = NOW() - interval '1 minute' WHERE assistant_user_id = $1::uuid`,
      [assistant.id],
    );
    await pool.end();

    const after = await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(assistantCookie))
      .send({ marked: true });
    assert.equal(after.status, 404);
  });

  it("keeps contact mark after task resync", async () => {
    const managerA = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerA.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerA.id,
    });
    await upsertEmployeePortalLink({
      userId: managerA.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "42",
    });
    const config = await seedPublishedTask({
      responsibleBitrixUserId: "42",
      responsibleUserId: managerA.id,
    });
    const app = await loadApp();
    const cookie = await login("manager-a@example.com");
    await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/9001/contact`)
      .set(authHeaders(cookie))
      .send({ marked: true });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const labelRow = await pool.query<{ label_code: string }>(
      `SELECT label_code FROM bitrix24_object_labels
       WHERE object_type = 'holding' AND object_guid = $1::uuid AND revoked_at IS NULL`,
      [HOLDING_ONE],
    );
    await pool.end();
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Updated title after sync",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T12:00:00+03:00",
      descriptionHash: "hash2",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: labelRow.rows[0]?.label_code ?? null,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });

    const tasks = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasks.body.tasks[0]?.contactAction?.marked, true);
  });
});

async function grantViewerClientAccess(
  databaseUrl: string,
  userId: string,
  clientGuid: string,
): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
  });
  const admin = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = 'admin@example.com'",
  );
  await pool.query(
    `INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
     VALUES ($1::uuid, 'client', $2::uuid, 'integration test', $3::uuid)`,
    [userId, clientGuid, admin.rows[0]!.id],
  );
  await pool.end();
}
