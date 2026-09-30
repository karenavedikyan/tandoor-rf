import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import {
  confirmObject,
  issueLabelInTransaction,
  LabelRepositoryError,
  revokeActiveLabel,
  unconfirmObject,
} from "../../src/bitrix24/labels/repository";
import { runBitrix24TaskSync } from "../../src/bitrix24/sync/run-sync";
import { resetPoolForTests } from "../../src/db/pool";
import {
  buildSyncScopeSummary,
  confirmObjectHierarchyLink,
  findLatestSyncJournalEntry,
  insertSyncJournalEntry,
  upsertEmployeePortalLink,
  upsertTaskSnapshot,
} from "../../src/bitrix24/tasks/repository";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  resetDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { resolveMigrationsDir } from "../../src/db/migrate-runner";
import {
  createDelegationRecord,
  denyClientAccess,
  grantClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";
import {
  HOLDING_ONE,
  HOLDING_TWO,
  linkCardToHolding,
  linkChildToHolding,
} from "../helpers/bitrix24-card-fixtures";
import { restoreRevokedLabel } from "../../src/bitrix24/labels/repository";
import { Pool } from "pg";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const LEGAL_ONE = "55555555-5555-4555-8555-555555555555";
const LEGAL_FOREIGN = "66666666-6666-4666-8666-666666666666";
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

async function seedAdminLink(databaseUrl: string, portalId: string, bitrixUserId = "42") {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const adminRow = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    ["admin@example.com"],
  );
  await pool.end();
  const adminId = adminRow.rows[0]?.id;
  assert.ok(adminId);
  await upsertEmployeePortalLink({
    userId: adminId,
    portalId,
    bitrixUserId,
  });
  return adminId;
}

describe("bitrix24 client labels integration", { concurrency: false }, () => {
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
    process.env.BITRIX24_PILOT_TASK_IDS = "9001,9002,9003,9004";
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
        guid_manager: "22222222-2222-4222-8222-222222222222",
        name_manager: "Manager A",
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

  it("issues label via POST and never on GET", async () => {
    const app = await loadApp();
    const cookie = await login("admin@example.com");

    const getMissing = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie));
    assert.equal(getMissing.status, 404);

    const postIssue = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie))
      .send({});
    assert.equal(postIssue.status, 201);
    assert.match(postIssue.body.token, /^#LK_H_\d{6}$/);

    const getExisting = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie));
    assert.equal(getExisting.status, 200);
    assert.equal(getExisting.body.token, postIssue.body.token);
  });

  it("rejects cache read when publish enabled but TTL is zero (ACC-01)", async () => {
    process.env.BITRIX24_CACHE_ACCESS_TTL_MS = "0";
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.status, 200);
    assert.equal(tasksRes.body.state, "cache_not_published");
  });

  it("denies tasks when pilot allow-list is empty (ACC-04)", async () => {
    process.env.BITRIX24_PILOT_TASK_IDS = "";
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9001",
                DESCRIPTION: formatLabelToken(label.labelCode),
              }),
            ],
          },
          total: 1,
        },
      },
    });
    await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });
    await seedAdminLink(databaseUrl, config.portalId);
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "pilot_list_missing");
  });

  it("syncs labeled task into client card cache", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9001",
                DESCRIPTION: `${formatLabelToken(label.labelCode)}\nОбычная задача`,
              }),
            ],
          },
          total: 1,
        },
      },
    });

    await seedAdminLink(databaseUrl, config.portalId);

    const dryRun = await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: false,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.bindingsConfirmed, 1);

    const applied = await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });
    assert.equal(applied.cacheWrites, 1);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.status, 200);
    assert.equal(tasksRes.body.state, "ready");
    assert.equal(tasksRes.body.tasks.length, 1);
    assert.equal(tasksRes.body.tasks[0]?.taskId, "9001");
    assert.ok(tasksRes.body.sync?.lastFinishedAt);
  });

  it("reports conflict when task description contains different labels", async () => {
    const config = sampleWebhookConfig();
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9002",
                DESCRIPTION: "#LK_H_000001\n#LK_J_000002",
              }),
            ],
          },
          total: 1,
        },
      },
    });

    await seedAdminLink(databaseUrl, config.portalId);
    const result = await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });
    assert.equal(result.bindingsConflict, 1);
    assert.equal(result.bindingsConfirmed, 0);
  });

  it("issues unique labels concurrently for different objects", async () => {
    const CLIENT_TWO = "22222222-2222-4222-8222-222222222222";
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_TWO,
        name_client: "Client Two",
        guid_manager: "22222222-2222-4222-8222-222222222222",
        name_manager: "Manager A",
      },
    ]);
    await linkCardToHolding(CLIENT_TWO, HOLDING_TWO);

    const [first, second] = await Promise.all([
      issueLabelInTransaction("holding", HOLDING_ONE),
      issueLabelInTransaction("holding", HOLDING_TWO),
    ]);
    assert.notEqual(first.labelCode, second.labelCode);
  });

  it("returns same label on concurrent issue for one object (PAR-01)", async () => {
    const [first, second] = await Promise.all([
      issueLabelInTransaction("holding", HOLDING_ONE),
      issueLabelInTransaction("holding", HOLDING_ONE),
    ]);
    assert.equal(first.labelCode, second.labelCode);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);
  });

  it("hides tasks when employee portal link access expired (ACC-03)", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9003",
                DESCRIPTION: formatLabelToken(label.labelCode),
              }),
            ],
          },
          total: 1,
        },
      },
    });
    await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const adminRow = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
      "admin@example.com",
    ]);
    await pool.end();
    await upsertEmployeePortalLink({
      userId: adminRow.rows[0]!.id,
      portalId: config.portalId,
      bitrixUserId: "42",
      accessExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.status, 200);
    assert.equal(tasksRes.body.state, "access_expired");
    assert.equal(tasksRes.body.tasks.length, 0);
  });

  it("does not apply stale sync over newer cache (ATO-01/02)", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    const newer = await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9010",
      responsibleBitrixUserId: "42",
      title: "Newer title",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T12:00:00+03:00",
      descriptionHash: "abc",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });
    assert.equal(newer.cacheUpdated, true);

    const stale = await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9010",
      responsibleBitrixUserId: "42",
      title: "Stale title",
      statusLabel: "waiting",
      deadline: null,
      changedAt: "2026-09-29T10:00:00+03:00",
      descriptionHash: "def",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });
    assert.equal(stale.cacheUpdated, false);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ title: string }>(
      "SELECT title FROM bitrix24_task_cache WHERE task_id = $1",
      ["9010"],
    );
    await pool.end();
    assert.equal(row.rows[0]?.title, "Newer title");
  });

  it("issues legal entity label when object confirmed (HJT-01)", async () => {
    await confirmObject("legal_entity", LEGAL_ONE, null);
    await linkChildToHolding(HOLDING_ONE, "legal_entity", LEGAL_ONE);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .post(
        `/api/clients/${CLIENT_ONE}/bitrix24/label?objectType=legal_entity&objectGuid=${LEGAL_ONE}`,
      )
      .set(authHeaders(cookie))
      .send({ objectType: "legal_entity", objectGuid: LEGAL_ONE });
    assert.equal(res.status, 201);
    assert.match(res.body.labelCode, /^LK_J_\d{6}$/);
    assert.match(res.body.token, /^#LK_J_\d{6}$/);
  });

  it("aggregates child legal entity tasks on holding card (HJT-03)", async () => {
    await confirmObject("legal_entity", LEGAL_ONE, null);
    await linkChildToHolding(HOLDING_ONE, "legal_entity", LEGAL_ONE);
    const label = await issueLabelInTransaction("legal_entity", LEGAL_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9004",
      responsibleBitrixUserId: "42",
      title: "Child entity task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "legal_entity",
      objectGuid: LEGAL_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks?objectType=holding`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "ready");
    assert.equal(tasksRes.body.tasks.length, 1);
    assert.equal(tasksRes.body.tasks[0]?.title, "Child entity task");
    assert.equal(tasksRes.body.visibility, undefined);
  });

  it("invalidates bindings when label is revoked (ACC-06)", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9011",
      responsibleBitrixUserId: "42",
      title: "Bound task",
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
    await seedAdminLink(databaseUrl, config.portalId);
    await revokeActiveLabel("holding", HOLDING_ONE);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "empty");
    assert.equal(tasksRes.body.tasks.length, 0);
    assert.equal(tasksRes.body.visibility, undefined);
  });

  it("blocks label issue after object unconfirmed (ACC-07)", async () => {
    await unconfirmObject("holding", HOLDING_ONE);
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie))
      .send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "OBJECT_NOT_CONFIRMED");
  });

  it("rejects invalid objectType with 400", async () => {
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks?objectType=invalid`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 400);
  });

  it("hides tasks after employee link is renewed without re-sync (STALE_SNAPSHOT)", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9003",
      responsibleBitrixUserId: "42",
      title: "Before link refresh",
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
    const adminId = await seedAdminLink(databaseUrl, config.portalId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await upsertEmployeePortalLink({
      userId: adminId,
      portalId: config.portalId,
      bitrixUserId: "42",
    });

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "stale_snapshot");
    assert.equal(tasksRes.body.tasks.length, 0);
  });

  it("returns 404 for foreign client card and tasks (manager HTTP)", async () => {
    const managerAUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    const managerBUser = await createTestUser({
      databaseUrl,
      email: "manager-b@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager B",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerAUser.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerAUser.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerBUser.id,
      employeeId: MANAGER_B,
      confirmedByUserId: managerBUser.id,
    });

    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_TWO,
        name_client: "Client Two",
        guid_manager: MANAGER_B,
        name_manager: "Manager B",
      },
    ]);

    const app = await loadApp();
    const cookie = await login("manager-a@example.com");
    const labelRes = await request(app)
      .get(`/api/clients/${CLIENT_TWO}/bitrix24/label`)
      .set(authHeaders(cookie));
    assert.equal(labelRes.status, 404);
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_TWO}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.status, 404);
  });

  it("does not aggregate foreign child object tasks (manager HTTP)", async () => {
    const managerAUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerAUser.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerAUser.id,
    });

    await confirmObject("legal_entity", LEGAL_FOREIGN, null);
    await linkChildToHolding(HOLDING_ONE, "legal_entity", LEGAL_FOREIGN);
    const foreignLabel = await issueLabelInTransaction("legal_entity", LEGAL_FOREIGN);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: managerAUser.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9004",
      responsibleBitrixUserId: "42",
      title: "Foreign child task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "legal_entity",
      objectGuid: LEGAL_FOREIGN,
      labelCode: foreignLabel.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });

    const app = await loadApp();
    const cookie = await login("manager-a@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "empty");
    assert.equal(tasksRes.body.tasks.length, 0);

    const labelRes = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/bitrix24/label?objectType=legal_entity&objectGuid=${LEGAL_FOREIGN}`,
      )
      .set(authHeaders(cookie));
    assert.equal(labelRes.status, 404);
  });

  it("closes bitrix24 card and tasks when delegation ends (assistant HTTP)", async () => {
    const managerAUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    const assistantUser = await createTestUser({
      databaseUrl,
      email: "assistant@example.com",
      password: TEST_PASSWORD,
      fullName: "Assistant User",
      role: "assistant",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerAUser.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerAUser.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: assistantUser.id,
      employeeId: ASSISTANT_EMP,
      confirmedByUserId: managerAUser.id,
    });

    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerAUser.id,
      assistantUserId: assistantUser.id,
      clientGuids: [CLIENT_ONE],
      status: "active",
      startsAt,
      endsAt,
      approvedByUserId: managerAUser.id,
    });

    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: assistantUser.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Delegated client task",
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

    const app = await loadApp();
    const activeCookie = await login("assistant@example.com");
    const activeTasks = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(activeCookie));
    assert.equal(activeTasks.status, 200);
    assert.equal(activeTasks.body.state, "ready");
    assert.equal(activeTasks.body.tasks.length, 1);

    const revokePool = new Pool({ connectionString: databaseUrl, max: 1 });
    await revokePool.query(
      `UPDATE delegations SET status = 'revoked', revoked_at = NOW() WHERE assistant_user_id = $1::uuid`,
      [assistantUser.id],
    );
    await revokePool.end();

    const revokedCookie = await login("assistant@example.com");
    const labelRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(revokedCookie));
    assert.equal(labelRes.status, 404);
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(revokedCookie));
    assert.equal(tasksRes.status, 404);

    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerAUser.id,
      assistantUserId: assistantUser.id,
      clientGuids: [CLIENT_ONE],
      status: "expired",
      startsAt: new Date(Date.now() - 7_200_000).toISOString(),
      endsAt: new Date(Date.now() - 3_600_000).toISOString(),
      approvedByUserId: managerAUser.id,
    });

    const expiredCookie = await login("assistant@example.com");
    const expiredTasks = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(expiredCookie));
    assert.equal(expiredTasks.status, 404);
  });

  it("rejects same changed_at with different title (version conflict)", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    const changedAt = "2026-09-30T12:00:00+03:00";
    const base = {
      portalId: config.portalId,
      taskId: "9020",
      responsibleBitrixUserId: "42",
      statusLabel: "in_progress",
      deadline: null,
      changedAt,
      descriptionHash: "same-hash",
      published: true,
      objectType: "holding" as const,
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    };
    await upsertTaskSnapshot({ ...base, title: "Original title" });
    const conflict = await upsertTaskSnapshot({ ...base, title: "Different title" });
    assert.equal(conflict.cacheUpdated, false);
    assert.equal(conflict.versionConflict, true);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ title: string }>(
      "SELECT title FROM bitrix24_task_cache WHERE task_id = $1",
      ["9020"],
    );
    await pool.end();
    assert.equal(row.rows[0]?.title, "Original title");
  });

  it("refreshes synced_at for identical snapshot at same changed_at", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    const changedAt = "2026-09-30T12:00:00+03:00";
    const snapshot = {
      portalId: config.portalId,
      taskId: "9021",
      responsibleBitrixUserId: "42",
      title: "Same title",
      statusLabel: "in_progress",
      deadline: null,
      changedAt,
      descriptionHash: "hash-1",
      published: true,
      objectType: "holding" as const,
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    };
    await upsertTaskSnapshot(snapshot);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const before = await pool.query<{ synced_at: Date }>(
      "SELECT synced_at FROM bitrix24_task_cache WHERE task_id = $1",
      ["9021"],
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    await upsertTaskSnapshot(snapshot);
    const after = await pool.query<{ synced_at: Date }>(
      "SELECT synced_at FROM bitrix24_task_cache WHERE task_id = $1",
      ["9021"],
    );
    await pool.end();
    assert.ok(after.rows[0]!.synced_at >= before.rows[0]!.synced_at);
  });

  it("hides tasks with future synced_at via HTTP", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Future synced task",
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
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE bitrix24_task_cache SET synced_at = '2099-01-01T00:00:00Z' WHERE task_id = $1`,
      ["9001"],
    );
    await pool.end();
    await seedAdminLink(databaseUrl, config.portalId, "42");

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "future_task");
    assert.equal(tasksRes.body.tasks.length, 0);
  });

  it("hides tasks when employee link confirmed_at is in the future (HTTP)", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9002",
      responsibleBitrixUserId: "42",
      title: "Future link task",
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
    const adminId = await seedAdminLink(databaseUrl, config.portalId, "42");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE bitrix24_employee_portal_links
       SET confirmed_at = '2099-01-01T00:00:00Z'
       WHERE user_id = $1::uuid AND portal_id = $2`,
      [adminId, config.portalId],
    );
    await pool.end();

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "access_expired");
    assert.equal(tasksRes.body.tasks.length, 0);
  });

  it("does not leak audience_denied when hidden tasks exist (HTTP)", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId, "42");
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9003",
      responsibleBitrixUserId: "999",
      title: "Other responsible task",
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

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "empty");
    assert.notEqual(tasksRes.body.state, "audience_denied");
    assert.equal(tasksRes.body.tasks.length, 0);
  });

  it("blocks re-issue after revoke and restores same label explicitly", async () => {
    const issued = await issueLabelInTransaction("holding", HOLDING_ONE);
    await revokeActiveLabel("holding", HOLDING_ONE);
    await assert.rejects(
      () => issueLabelInTransaction("holding", HOLDING_ONE),
      (error: unknown) => error instanceof LabelRepositoryError && error.code === "LABEL_REVOKED",
    );
    const restored = await restoreRevokedLabel("holding", HOLDING_ONE, null);
    assert.equal(restored.labelCode, issued.labelCode);
    assert.equal(restored.restored, true);
  });

  it("returns domain error when label sequence exhausted at 999999", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE bitrix24_label_sequences SET next_value = 999999, exhausted = FALSE WHERE object_type = 'holding'`,
    );
    await pool.end();
    const issued = await issueLabelInTransaction("holding", HOLDING_ONE);
    assert.equal(issued.labelCode, "LK_H_999999");
    await confirmObject("holding", HOLDING_TWO, null);
    await assert.rejects(
      () => issueLabelInTransaction("holding", HOLDING_TWO),
      (error: unknown) =>
        error instanceof LabelRepositoryError && error.code === "LABEL_SEQUENCE_EXHAUSTED",
    );
  });

  it("rejects sync for unconfirmed bitrix user before transport", async () => {
    const config = sampleWebhookConfig();
    const { pinnedRequest, calls } = createBitrixMockPinnedRequest({
      [`${config.webhookBaseUrl}tasks.task.list`]: {
        body: { result: { tasks: [] }, total: 0 },
      },
    });
    const result = await runBitrix24TaskSync({
      bitrixUserId: "99999",
      apply: true,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(calls.length, 0);
    assert.ok(result.journalId);
  });

  it("returns partial status and writes journal for truncated sync", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9001",
                DESCRIPTION: formatLabelToken(label.labelCode),
              }),
            ],
          },
          total: 99,
          next: 50,
        },
      },
    });
    const result = await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      maxPages: 1,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });
    assert.equal(result.status, "partial");
    assert.equal(result.ok, false);
    assert.equal(result.complete, false);
    assert.ok(result.journalId);
  });

  it("serves J/T tasks by objectGuid without onec_clients row (HTTP)", async () => {
    await confirmObject("legal_entity", LEGAL_ONE, null);
    await linkChildToHolding(HOLDING_ONE, "legal_entity", LEGAL_ONE);
    const label = await issueLabelInTransaction("legal_entity", LEGAL_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9004",
      responsibleBitrixUserId: "42",
      title: "Legal entity direct task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "legal_entity",
      objectGuid: LEGAL_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/bitrix24/tasks?objectType=legal_entity&objectGuid=${LEGAL_ONE}`,
      )
      .set(authHeaders(cookie));
    assert.equal(tasksRes.status, 200);
    assert.equal(tasksRes.body.state, "ready");
    assert.equal(tasksRes.body.tasks.length, 1);
    assert.equal(tasksRes.body.tasks[0]?.boundObjectLabel, "Юрлицо");
  });

  it("updates publish and binding on unchanged source version", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    const changedAt = "2026-09-30T12:00:00+03:00";
    const base = {
      portalId: config.portalId,
      taskId: "9030",
      responsibleBitrixUserId: "42",
      title: "Stable task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt,
      descriptionHash: "stable-hash",
      published: false,
      objectType: "holding" as const,
      objectGuid: HOLDING_ONE,
      labelCode: null,
      bindingStatus: "pending_confirmation",
      conflictReason: null,
      linkedAt: null,
    };
    await upsertTaskSnapshot(base);
    const published = await upsertTaskSnapshot({
      ...base,
      published: true,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      linkedAt: new Date().toISOString(),
    });
    assert.equal(published.cacheUpdated, true);
    assert.equal(published.versionConflict, undefined);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ published: boolean; binding_status: string }>(
      `SELECT c.published, b.binding_status
       FROM bitrix24_task_cache c
       JOIN bitrix24_task_bindings b ON b.portal_id = c.portal_id AND b.task_id = c.task_id
       WHERE c.task_id = $1`,
      ["9030"],
    );
    await pool.end();
    assert.equal(row.rows[0]?.published, true);
    assert.equal(row.rows[0]?.binding_status, "confirmed");
  });

  it("foreign audience-mismatch tasks never change API state", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId, "42");
    const baseSnapshot = {
      portalId: config.portalId,
      taskId: "9031",
      responsibleBitrixUserId: "999",
      title: "Foreign audience task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "holding" as const,
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    };
    await upsertTaskSnapshot(baseSnapshot);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const fresh = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(fresh.body.state, "empty");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE bitrix24_task_cache SET synced_at = '2099-01-01T00:00:00Z' WHERE task_id = $1`,
      ["9031"],
    );
    await pool.end();
    const stale = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(stale.body.state, "empty");
    assert.notEqual(stale.body.state, "future_task");

    await upsertTaskSnapshot({
      ...baseSnapshot,
      taskId: "9032",
      responsibleBitrixUserId: "999",
      title: "Foreign out-of-pilot task",
    });
    const outOfPilot = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(outOfPilot.body.state, "empty");
    assert.notEqual(outOfPilot.body.state, "pilot_filtered");
  });

  it("findLatestSyncJournalEntry matches bitrix user exactly", async () => {
    const config = sampleWebhookConfig();
    await insertSyncJournalEntry({
      runMode: "apply",
      scopeSummary: buildSyncScopeSummary(config.portalId, "420"),
      status: "success",
      summary: { marker: "user-420" },
    });
    await insertSyncJournalEntry({
      runMode: "apply",
      scopeSummary: buildSyncScopeSummary(config.portalId, "42"),
      status: "partial",
      summary: { marker: "user-42" },
    });
    const entry = await findLatestSyncJournalEntry(config.portalId, "42");
    assert.ok(entry);
    assert.equal(entry.summary.marker, "user-42");
  });

  it("denies label restore for assistant even with card access", async () => {
    const managerAUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    const assistantUser = await createTestUser({
      databaseUrl,
      email: "assistant@example.com",
      password: TEST_PASSWORD,
      fullName: "Assistant User",
      role: "assistant",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerAUser.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerAUser.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: assistantUser.id,
      employeeId: ASSISTANT_EMP,
      confirmedByUserId: managerAUser.id,
    });
    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: managerAUser.id,
      assistantUserId: assistantUser.id,
      clientGuids: [CLIENT_ONE],
      status: "active",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      approvedByUserId: managerAUser.id,
    });
    await issueLabelInTransaction("holding", HOLDING_ONE);
    await revokeActiveLabel("holding", HOLDING_ONE);

    const app = await loadApp();
    const cookie = await login("assistant@example.com");
    const res = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie))
      .send({ restore: true });
    assert.equal(res.status, 403);
  });

  it("allows child object access only with explicit grant (manager HTTP)", async () => {
    const managerAUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerAUser.id,
      employeeId: MANAGER_A,
      confirmedByUserId: managerAUser.id,
    });
    await confirmObject("legal_entity", LEGAL_ONE, null);
    await linkChildToHolding(HOLDING_ONE, "legal_entity", LEGAL_ONE);
    await grantClientAccess({
      databaseUrl,
      userId: managerAUser.id,
      objectId: LEGAL_ONE,
      grantedByUserId: managerAUser.id,
    });
    const label = await issueLabelInTransaction("legal_entity", LEGAL_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: managerAUser.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9004",
      responsibleBitrixUserId: "42",
      title: "Granted child task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "legal_entity",
      objectGuid: LEGAL_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });

    const app = await loadApp();
    const cookie = await login("manager-a@example.com");
    const tasksRes = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/bitrix24/tasks?objectType=legal_entity&objectGuid=${LEGAL_ONE}`,
      )
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "ready");
    assert.equal(tasksRes.body.tasks.length, 1);
  });

  it("migrates invalid changed_at safely without crashing or backdating", async () => {
    await resetDatabase(databaseUrl);
    const migrationsDir = resolveMigrationsDir();
    const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    for (const filename of files) {
      if (filename === "011_bitrix24_r22_fixes.sql") {
        break;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
    }
    await pool.query(
      `INSERT INTO bitrix24_task_cache (
         portal_id, task_id, title, status_label, changed_at, description_hash, published
       ) VALUES
         ('p', 'empty', 'Empty date', 'in_progress', '', 'abc', TRUE),
         ('p', 'invalid', 'Invalid ISO', 'in_progress', '2026-02-30T12:00:00Z', 'def', TRUE),
         ('p', 'valid', 'Valid TZ', 'in_progress', '2026-01-15T09:30:00+05:00', 'ghi', FALSE)`,
    );
    const migration011 = fs.readFileSync(
      path.join(migrationsDir, "011_bitrix24_r22_fixes.sql"),
      "utf8",
    );
    await pool.query(migration011);
    await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
      "011_bitrix24_r22_fixes.sql",
    ]);
    const rows = await pool.query<{
      task_id: string;
      changed_at: Date | null;
      published: boolean;
    }>(`SELECT task_id, changed_at, published FROM bitrix24_task_cache ORDER BY task_id`);
    await pool.end();

    const byId = Object.fromEntries(rows.rows.map((row) => [row.task_id, row]));
    assert.equal(byId.empty?.changed_at, null);
    assert.equal(byId.empty?.published, false);
    assert.equal(byId.invalid?.changed_at, null);
    assert.equal(byId.invalid?.published, false);
    assert.ok(byId.valid?.changed_at instanceof Date);
    assert.equal(byId.valid?.published, false);
    assert.equal(byId.valid?.changed_at?.toISOString(), "2026-01-15T04:30:00.000Z");
  });

  it("denies director child object access when explicit denial exists", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const adminRow = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      ["admin@example.com"],
    );
    await pool.end();
    const adminUserId = adminRow.rows[0]?.id;
    assert.ok(adminUserId);
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
      employeeId: MANAGER_A,
      confirmedByUserId: adminUserId,
    });
    await confirmObject("legal_entity", LEGAL_ONE, null);
    await linkChildToHolding(HOLDING_ONE, "legal_entity", LEGAL_ONE);
    const childLabel = await issueLabelInTransaction("legal_entity", LEGAL_ONE);
    await denyClientAccess({
      databaseUrl,
      userId: directorUser.id,
      scopeType: "client",
      objectId: LEGAL_ONE,
      deniedByUserId: adminUserId,
    });
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: directorUser.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9004",
      responsibleBitrixUserId: "42",
      title: "Denied child task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "legal_entity",
      objectGuid: LEGAL_ONE,
      labelCode: childLabel.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });

    const app = await loadApp();
    const cookie = await login("director@example.com");
    const labelRes = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/bitrix24/label?objectType=legal_entity&objectGuid=${LEGAL_ONE}`,
      )
      .set(authHeaders(cookie));
    assert.equal(labelRes.status, 404);
    const tasksRes = await request(app)
      .get(
        `/api/clients/${CLIENT_ONE}/bitrix24/tasks?objectType=legal_entity&objectGuid=${LEGAL_ONE}`,
      )
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "empty");
    assert.equal(tasksRes.body.tasks.length, 0);
  });

  it("denies holding access when holding GUID differs from card and is explicitly denied", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const adminRow = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      ["admin@example.com"],
    );
    await pool.end();
    const adminUserId = adminRow.rows[0]?.id;
    assert.ok(adminUserId);
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
      employeeId: MANAGER_A,
      confirmedByUserId: adminUserId,
    });
    const holdingLabel = await issueLabelInTransaction("holding", HOLDING_ONE);
    await denyClientAccess({
      databaseUrl,
      userId: directorUser.id,
      scopeType: "client",
      objectId: HOLDING_ONE,
      deniedByUserId: adminUserId,
    });
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: directorUser.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Denied holding task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T11:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: holdingLabel.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });

    const app = await loadApp();
    const cookie = await login("director@example.com");
    const labelRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie));
    assert.equal(labelRes.status, 404);
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "empty");
    assert.equal(tasksRes.body.tasks.length, 0);
  });

  it("denies label restore for manager and regional manager with read access only", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const adminRow = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      ["admin@example.com"],
    );
    await pool.end();
    const adminUserId = adminRow.rows[0]?.id;
    assert.ok(adminUserId);
    const managerAUser = await createTestUser({
      databaseUrl,
      email: "manager-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A",
      role: "manager",
    });
    const regionalUser = await createTestUser({
      databaseUrl,
      email: "regional@example.com",
      password: TEST_PASSWORD,
      fullName: "Regional User",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: managerAUser.id,
      employeeId: MANAGER_A,
      confirmedByUserId: adminUserId,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: regionalUser.id,
      employeeId: MANAGER_B,
      confirmedByUserId: adminUserId,
    });
    await grantClientAccess({
      databaseUrl,
      userId: regionalUser.id,
      objectId: CLIENT_ONE,
      grantedByUserId: adminUserId,
    });
    await issueLabelInTransaction("holding", HOLDING_ONE);
    await revokeActiveLabel("holding", HOLDING_ONE);

    const app = await loadApp();
    const managerCookie = await login("manager-a@example.com");
    const managerRes = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(managerCookie))
      .send({ restore: true });
    assert.equal(managerRes.status, 403);

    const regionalCookie = await login("regional@example.com");
    const regionalRes = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(regionalCookie))
      .send({ restore: true });
    assert.equal(regionalRes.status, 403);
  });

  it("allows admin restore with same label code and audit entry", async () => {
    const issued = await issueLabelInTransaction("holding", HOLDING_ONE);
    await revokeActiveLabel("holding", HOLDING_ONE);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie))
      .send({ restore: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.labelCode, issued.labelCode);
    assert.equal(res.body.restored, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM bitrix24_label_audit
       WHERE action = 'restore' AND label_code = $1`,
      [issued.labelCode],
    );
    await pool.end();
    assert.equal(audit.rowCount, 1);
  });

  it("diagnostics CLI returns journal for selected bitrix user only", async () => {
    const config = sampleWebhookConfig();
    await insertSyncJournalEntry({
      runMode: "apply",
      scopeSummary: buildSyncScopeSummary(config.portalId, "420"),
      status: "success",
      summary: { marker: "user-420" },
    });
    await insertSyncJournalEntry({
      runMode: "apply",
      scopeSummary: buildSyncScopeSummary(config.portalId, "42"),
      status: "partial",
      summary: { marker: "user-42" },
    });

    const result = spawnSync(
      process.execPath,
      ["dist/cli/bitrix24-diagnostics.js", "--bitrix-user-id", "42"],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PGSSLMODE: "disable",
          BITRIX24_ENABLED: "true",
          BITRIX24_WEBHOOK_URL: config.webhookBaseUrl,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout) as {
      latestSync: { summary: { marker: string } } | null;
      bitrixUserId: string;
    };
    assert.equal(payload.bitrixUserId, "42");
    assert.equal(payload.latestSync?.summary.marker, "user-42");
  });

  it("returns 400 when card and holding IDs differ without mapping", async () => {
    const UNMAPPED_CARD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: UNMAPPED_CARD,
        name_client: "Unmapped card",
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
      },
    ]);
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${UNMAPPED_CARD}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 400);
  });
});
