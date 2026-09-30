import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import { issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import { runBitrix24TaskSync } from "../../src/bitrix24/sync/run-sync";
import { upsertChecklistSnapshot } from "../../src/bitrix24/tasks/checklist-repository";
import { upsertEmployeePortalLink, upsertTaskSnapshot } from "../../src/bitrix24/tasks/repository";
import { resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";
import { HOLDING_ONE, linkCardToHolding } from "../helpers/bitrix24-card-fixtures";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";
import {
  sampleChecklistItem,
  sampleChecklistRootGroup,
  sampleNestedChecklistResponse,
} from "../helpers/bitrix24-checklist-fixtures";
import { insertSummaryPublication } from "../helpers/bitrix24-work-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";

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

async function seedAdminLink(databaseUrl: string, portalId: string, bitrixUserId = "42") {
  const admin = await createTestUser({
    databaseUrl,
    email: "admin@example.com",
    password: TEST_PASSWORD,
    fullName: "Admin User",
    role: "admin",
  });
  await upsertEmployeePortalLink({
    userId: admin.id,
    portalId,
    bitrixUserId,
  });
  return admin;
}

describe("bitrix24 task checklists integration", { concurrency: false }, () => {
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

  it("syncs checklist snapshot and exposes matching progress for full access", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [`${config.webhookBaseUrl}tasks.task.list`]: {
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
      [`${config.webhookBaseUrl}task.checklistitem.getlist`]: {
        body: { result: sampleNestedChecklistResponse(), total: 5 },
      },
    });
    const sync = await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
      env: process.env,
    });
    assert.equal(sync.checklistsSynced, 1);
    assert.equal(sync.checklistsFailed, 0);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.state, "ready");
    const task = res.body.tasks[0];
    assert.equal(task.accessLevel, "full");
    assert.equal(task.checklist.state, "ready");
    assert.deepEqual(task.checklist.progress, { completed: 2, total: 3 });
    assert.ok(task.checklist.syncedAtLabel);
    assert.equal(task.checklist.items.length, 1);
  });

  it("does not leak checklist fields to summary-only viewers", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    const admin = await seedAdminLink(databaseUrl, config.portalId);
    const responsible = await createTestUser({
      databaseUrl,
      email: "responsible@example.com",
      password: TEST_PASSWORD,
      fullName: "Responsible User",
      role: "manager",
    });
    const viewer = await createTestUser({
      databaseUrl,
      email: "viewer@example.com",
      password: TEST_PASSWORD,
      fullName: "Viewer User",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: viewer.id,
      employeeId: MANAGER_B,
      confirmedByUserId: viewer.id,
    });
    await upsertEmployeePortalLink({
      userId: responsible.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    await upsertEmployeePortalLink({
      userId: viewer.id,
      portalId: config.portalId,
      bitrixUserId: "99",
    });
    await grantViewerClientAccess(databaseUrl, viewer.id, CLIENT_ONE);
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Secret title",
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
    await insertSummaryPublication({
      databaseUrl,
      portalId: config.portalId,
      taskId: "9001",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      briefText: "Краткое поручение",
      publishedByUserId: admin.id,
    });
    const checklistPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const checklistClient = await checklistPool.connect();
    try {
      await upsertChecklistSnapshot(
        {
          portalId: config.portalId,
          taskId: "9001",
          objectType: "holding",
          objectGuid: HOLDING_ONE,
          loadStatus: "loaded",
          syncComplete: true,
          items: [
            {
              itemId: "433",
              parentId: "431",
              title: "Hidden item",
              sortIndex: 0,
              isComplete: false,
              memberBitrixIds: [],
              isRootGroup: false,
            },
          ],
        },
        checklistClient,
      );
    } finally {
      checklistClient.release();
      await checklistPool.end();
    }

    const app = await loadApp();
    const cookie = await login("viewer@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.tasks[0]?.accessLevel, "summary");
    assert.equal(res.body.tasks[0]?.checklist, undefined);
  });

  it("hides checklist when binding no longer matches cached snapshot", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Cached task",
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
    const client = await pool.connect();
    try {
      await upsertChecklistSnapshot(
        {
          portalId: config.portalId,
          taskId: "9001",
          objectType: "holding",
          objectGuid: CLIENT_TWO,
          loadStatus: "loaded",
          syncComplete: true,
          items: [
            {
              itemId: "433",
              parentId: "431",
              title: "Чужой чек-лист",
              sortIndex: 0,
              isComplete: true,
              memberBitrixIds: [],
              isRootGroup: false,
            },
          ],
        },
        client,
      );
    } finally {
      client.release();
      await pool.end();
    }

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.tasks[0]?.checklist?.state, "not_loaded");
  });

  it("clears stale checklist progress when sync fetch fails", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const taskPayload = {
      result: {
        tasks: [
          sampleValidBitrixTask({
            ID: "9001",
            DESCRIPTION: formatLabelToken(label.labelCode),
          }),
        ],
      },
      total: 1,
    };
    await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      pinnedRequest: createBitrixMockPinnedRequest({
        [tasksUrl]: { body: taskPayload },
        [checklistUrl]: {
          body: {
            result: [
              sampleChecklistRootGroup(),
              sampleChecklistItem({ id: "433", parentId: "431", title: "Шаг 1", isComplete: "Y" }),
            ],
            total: 2,
          },
        },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });

    await runBitrix24TaskSync({
      bitrixUserId: "42",
      apply: true,
      pinnedRequest: createBitrixMockPinnedRequest({
        [tasksUrl]: { body: taskPayload },
        [checklistUrl]: { status: 403, body: { error: "ACCESS_DENIED" } },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.tasks[0]?.checklist?.state, "error");
    assert.equal(res.body.tasks[0]?.checklist?.progress, undefined);
  });

  it("card API reads cache only and never calls Bitrix checklist transport", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await seedAdminLink(databaseUrl, config.portalId);
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Cached task",
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
    const client = await pool.connect();
    await upsertChecklistSnapshot(
      {
        portalId: config.portalId,
        taskId: "9001",
        objectType: "holding",
        objectGuid: HOLDING_ONE,
        loadStatus: "empty",
        syncComplete: true,
        items: [],
      },
      client,
    );
    client.release();
    await pool.end();

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const { pinnedRequest, calls } = createBitrixMockPinnedRequest({});
    void pinnedRequest;
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.body.tasks[0]?.checklist?.state, "empty");
    assert.equal(calls.length, 0);
  });
});

async function grantViewerClientAccess(
  databaseUrl: string,
  userId: string,
  clientGuid: string,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
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
