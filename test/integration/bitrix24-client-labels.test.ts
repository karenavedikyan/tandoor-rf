import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import {
  confirmObject,
  issueLabelInTransaction,
  revokeActiveLabel,
  unconfirmObject,
} from "../../src/bitrix24/labels/repository";
import { runBitrix24TaskSync } from "../../src/bitrix24/sync/run-sync";
import { resetPoolForTests } from "../../src/db/pool";
import {
  confirmObjectHierarchyLink,
  invalidateBindingsForLabel,
  upsertEmployeePortalLink,
  upsertTaskSnapshot,
} from "../../src/bitrix24/tasks/repository";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";
import { Pool } from "pg";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const LEGAL_ONE = "55555555-5555-4555-8555-555555555555";

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
    await confirmObject("holding", CLIENT_ONE, null);
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
    const label = await issueLabelInTransaction("holding", CLIENT_ONE);
    const config = sampleWebhookConfig();
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
    const label = await issueLabelInTransaction("holding", CLIENT_ONE);
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

    await seedAdminLink(databaseUrl, config.portalId);

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
    await confirmObject("holding", CLIENT_TWO, null);

    const [first, second] = await Promise.all([
      issueLabelInTransaction("holding", CLIENT_ONE),
      issueLabelInTransaction("holding", CLIENT_TWO),
    ]);
    assert.notEqual(first.labelCode, second.labelCode);
  });

  it("returns same label on concurrent issue for one object (PAR-01)", async () => {
    const [first, second] = await Promise.all([
      issueLabelInTransaction("holding", CLIENT_ONE),
      issueLabelInTransaction("holding", CLIENT_ONE),
    ]);
    assert.equal(first.labelCode, second.labelCode);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);
  });

  it("hides tasks when employee portal link access expired (ACC-03)", async () => {
    const label = await issueLabelInTransaction("holding", CLIENT_ONE);
    const config = sampleWebhookConfig();
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
    const label = await issueLabelInTransaction("holding", CLIENT_ONE);
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
      objectGuid: CLIENT_ONE,
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
      objectGuid: CLIENT_ONE,
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
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: LEGAL_ONE,
        name_client: "Legal Entity One",
        guid_manager: "22222222-2222-4222-8222-222222222222",
        name_manager: "Manager A",
      },
    ]);
    await confirmObject("legal_entity", LEGAL_ONE, null);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .post(`/api/clients/${LEGAL_ONE}/bitrix24/label?objectType=legal_entity`)
      .set(authHeaders(cookie))
      .send({ objectType: "legal_entity" });
    assert.equal(res.status, 201);
    assert.match(res.body.labelCode, /^LK_J_\d{6}$/);
    assert.match(res.body.token, /^#LK_J_\d{6}$/);
  });

  it("aggregates child legal entity tasks on holding card (HJT-03)", async () => {
    await confirmObject("legal_entity", LEGAL_ONE, null);
    await confirmObjectHierarchyLink(CLIENT_ONE, "legal_entity", LEGAL_ONE);
    const label = await issueLabelInTransaction("legal_entity", LEGAL_ONE);
    const config = sampleWebhookConfig();
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
    await seedAdminLink(databaseUrl, config.portalId);

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks?objectType=holding`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.body.state, "ready");
    assert.equal(tasksRes.body.tasks.length, 1);
    assert.equal(tasksRes.body.tasks[0]?.boundObjectType, "legal_entity");
  });

  it("invalidates bindings when label is revoked (ACC-06)", async () => {
    const label = await issueLabelInTransaction("holding", CLIENT_ONE);
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
      objectGuid: CLIENT_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });
    const revoked = await revokeActiveLabel("holding", CLIENT_ONE);
    assert.ok(revoked);
    await invalidateBindingsForLabel(config.portalId, revoked!.labelCode, "label_revoked");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const binding = await pool.query<{ binding_status: string }>(
      "SELECT binding_status FROM bitrix24_task_bindings WHERE task_id = $1",
      ["9011"],
    );
    await pool.end();
    assert.equal(binding.rows[0]?.binding_status, "label_revoked");
  });

  it("blocks label issue after object unconfirmed (ACC-07)", async () => {
    await unconfirmObject("holding", CLIENT_ONE);
    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const res = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/label`)
      .set(authHeaders(cookie))
      .send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "OBJECT_NOT_CONFIRMED");
  });
});
