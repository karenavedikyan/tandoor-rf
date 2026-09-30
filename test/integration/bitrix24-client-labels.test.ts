import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import { confirmObject, issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import { upsertEmployeePortalLink } from "../../src/bitrix24/tasks/repository";
import { runBitrix24TaskSync } from "../../src/bitrix24/sync/run-sync";
import { resetPoolForTests } from "../../src/db/pool";
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
import { Pool } from "pg";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";

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
      portalId: config.portalId,
      bitrixUserId: "42",
    });

    const app = await loadApp();
    const cookie = await login("admin@example.com");
    const tasksRes = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasksRes.status, 200);
    assert.equal(tasksRes.body.state, "ready");
    assert.equal(tasksRes.body.tasks.length, 1);
    assert.equal(tasksRes.body.tasks[0]?.taskId, "9001");
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
    assert.match(first.labelCode, /^LK_H_\d{6}$/);
    assert.match(second.labelCode, /^LK_H_\d{6}$/);
  });

  it("hides tasks when employee portal link access expired", async () => {
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
    const adminRow = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      ["admin@example.com"],
    );
    await pool.end();
    const adminId = adminRow.rows[0]?.id;
    assert.ok(adminId);
    await upsertEmployeePortalLink({
      userId: adminId,
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
    assert.equal(tasksRes.body.state, "empty");
    assert.equal(tasksRes.body.tasks.length, 0);
  });
});
