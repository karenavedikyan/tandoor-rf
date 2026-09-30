import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import { issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import {
  acquireManualSyncLock,
  acquireManualSyncLocks,
  loadManualSyncMinIntervalMs,
} from "../../src/bitrix24/sync/manual-sync-lock";
import { runClientCardBitrix24Sync } from "../../src/bitrix24/sync/client-card-sync";
import { upsertChecklistSnapshot } from "../../src/bitrix24/tasks/checklist-repository";
import { upsertEmployeePortalLink, upsertTaskSnapshot } from "../../src/bitrix24/tasks/repository";
import { requirePool, resetPoolForTests } from "../../src/db/pool";
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
import { HOLDING_ONE, HOLDING_TWO, linkCardToHolding } from "../helpers/bitrix24-card-fixtures";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";
import {
  sampleChecklistItem,
  sampleChecklistRootGroup,
} from "../helpers/bitrix24-checklist-fixtures";
import { insertSummaryPublication } from "../helpers/bitrix24-work-fixtures";
import { Pool } from "pg";
import type { AccessContext } from "../../src/access/types";
import type { UserRole } from "../../src/shared/user";

function accessContext(
  userId: string,
  role: UserRole,
  employeeId: string | null = null,
): AccessContext {
  return {
    userId,
    role,
    status: "active",
    employeeId,
    employeeLinkConflict: false,
    hasEmployeeLink: employeeId !== null,
    hasScopedClientAccess: true,
    fullClientBase: role === "admin" || role === "director",
    explicitlyDeniedAll: false,
  };
}


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

async function seedResponsibleTask(input: {
  userId: string;
  bitrixUserId: string;
  changedAt?: string;
}) {
  const label = await issueLabelInTransaction("holding", HOLDING_ONE);
  const config = sampleWebhookConfig();
  await upsertEmployeePortalLink({
    userId: input.userId,
    portalId: config.portalId,
    bitrixUserId: input.bitrixUserId,
  });
  await upsertTaskSnapshot({
    portalId: config.portalId,
    taskId: "9001",
    responsibleBitrixUserId: input.bitrixUserId,
    title: "Pilot task",
    statusLabel: "in_progress",
    deadline: null,
    changedAt: input.changedAt ?? "2026-09-30T11:00:00+03:00",
    descriptionHash: "hash",
    published: true,
    objectType: "holding",
    objectGuid: HOLDING_ONE,
    labelCode: label.labelCode,
    bindingStatus: "confirmed",
    conflictReason: null,
    linkedAt: new Date().toISOString(),
  });
  return { label, config };
}

async function linkManagerToEmployee(
  dbUrl: string,
  userId: string,
  employeeId: string,
) {
  await linkUserToEmployee({
    databaseUrl: dbUrl,
    userId,
    employeeId,
    confirmedByUserId: userId,
  });
}

describe("bitrix24 manual card sync integration", { concurrency: false }, () => {
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
    process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS = "60000";
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
    delete process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS;
  });

  it("updates checklist progress to 2 of 3 in overview and work after sync", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
    const { label, config } = await seedResponsibleTask({
      userId: manager.id,
      bitrixUserId: "42",
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      const generation = await client.query<{ cache_version: number; synced_at: Date }>(
        `SELECT cache_version, synced_at
         FROM bitrix24_task_cache
         WHERE portal_id = $1 AND task_id = $2`,
        [config.portalId, "9001"],
      );
      const row = generation.rows[0]!;
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
              itemId: "431",
              taskId: "9001",
              parentId: null,
              title: "Root",
              sortIndex: 0,
              isComplete: false,
              coExecutorBitrixIds: [],
              isRootGroup: true,
            },
            {
              itemId: "433",
              taskId: "9001",
              parentId: "431",
              title: "Step 1",
              sortIndex: 0,
              isComplete: true,
              coExecutorBitrixIds: [],
              isRootGroup: false,
            },
          ],
          taskCacheVersion: Number(row.cache_version),
          taskSyncedAt: row.synced_at.toISOString(),
        },
        client,
      );
    } finally {
      client.release();
      await pool.end();
    }

    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [tasksUrl]: {
          body: {
            result: {
              tasks: [
                sampleValidBitrixTask({
                  ID: "9001",
                  DESCRIPTION: formatLabelToken(label.labelCode),
                  CHANGED_DATE: "2026-09-30T12:00:00+03:00",
                }),
              ],
            },
            total: 1,
          },
        },
        [checklistUrl]: {
          body: {
            result: [
              sampleChecklistRootGroup(),
              sampleChecklistItem({ id: "433", parentId: "431", title: "A", isComplete: "Y" }),
              sampleChecklistItem({ id: "434", parentId: "431", title: "B", isComplete: "Y" }),
              sampleChecklistItem({ id: "435", parentId: "431", title: "C", isComplete: "N" }),
            ],
            total: 4,
          },
        },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus !== 200) {
      return;
    }
    assert.equal(sync.body.complete, true);

    const app = await loadApp();
    const cookie = await login("manager@example.com");
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(res.status, 200);
    const task = res.body.tasks[0];
    assert.equal(task.checklist.progress.completed, 2);
    assert.equal(task.checklist.progress.total, 3);
  });

  it("denies sync for foreign client card", async () => {
    const owner = await createTestUser({
      databaseUrl,
      email: "owner@example.com",
      password: TEST_PASSWORD,
      fullName: "Owner Manager",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, owner.id, MANAGER_A);
    await seedResponsibleTask({ userId: owner.id, bitrixUserId: "42" });

    const foreign = await createTestUser({
      databaseUrl,
      email: "foreign@example.com",
      password: TEST_PASSWORD,
      fullName: "Foreign Manager",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, foreign.id, MANAGER_B);

    const app = await loadApp();
    const foreignCookie = await login("foreign@example.com");
    const foreignRes = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/sync`)
      .set(authHeaders(foreignCookie))
      .send({});
    assert.equal(foreignRes.status, 404);
  });

  it("denies sync for summary-only viewer", async () => {
    const owner = await createTestUser({
      databaseUrl,
      email: "owner@example.com",
      password: TEST_PASSWORD,
      fullName: "Owner Manager",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, owner.id, MANAGER_A);
    await seedResponsibleTask({ userId: owner.id, bitrixUserId: "42" });

    const viewer = await createTestUser({
      databaseUrl,
      email: "viewer@example.com",
      password: TEST_PASSWORD,
      fullName: "Summary Viewer",
      role: "regional_manager",
    });
    await linkManagerToEmployee(databaseUrl, viewer.id, MANAGER_B);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
       VALUES ($1::uuid, 'client', $2::uuid, 'integration test', $3::uuid)`,
      [viewer.id, CLIENT_ONE, owner.id],
    );
    await pool.end();
    await upsertEmployeePortalLink({
      userId: viewer.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "99",
    });
    await insertSummaryPublication({
      databaseUrl,
      portalId: sampleWebhookConfig().portalId,
      taskId: "9001",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      briefText: "Summary only",
      publishedByUserId: owner.id,
    });

    const app = await loadApp();
    const viewerCookie = await login("viewer@example.com");
    const summaryRes = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/sync`)
      .set(authHeaders(viewerCookie))
      .send({});
    assert.equal(summaryRes.status, 403);
  });

  it("denies sync without confirmed Bitrix employee link", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "9001",
      responsibleBitrixUserId: "42",
      title: "Pilot task",
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

    const unlinked = await createTestUser({
      databaseUrl,
      email: "unlinked@example.com",
      password: TEST_PASSWORD,
      fullName: "Unlinked",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, unlinked.id, MANAGER_A);

    const app = await loadApp();
    const unlinkedCookie = await login("unlinked@example.com");
    const noLinkRes = await request(app)
      .post(`/api/clients/${CLIENT_ONE}/bitrix24/sync`)
      .set(authHeaders(unlinkedCookie))
      .send({});
    assert.equal(noLinkRes.status, 403);
  });

  it("returns 429 for immediate repeat sync request", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
    const { label, config } = await seedResponsibleTask({
      userId: manager.id,
      bitrixUserId: "42",
    });
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const mock = createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9001",
                DESCRIPTION: formatLabelToken(label.labelCode),
                CHANGED_DATE: "2026-09-30T12:00:00+03:00",
              }),
            ],
          },
          total: 1,
        },
      },
      [checklistUrl]: {
        body: {
          result: [sampleChecklistRootGroup()],
          total: 1,
        },
      },
    });
    const first = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: mock.pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(first.httpStatus, 200);

    const repeat = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: mock.pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(repeat.httpStatus, 429);
    if (repeat.httpStatus === 429) {
      assert.ok((repeat.body.retryAfterMs ?? 0) > 0);
    }
  });

  it("returns 403 without publishing or fetching a checklist for an unresolved source", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
    await seedResponsibleTask({
      userId: manager.id,
      bitrixUserId: "42",
    });
    const config = sampleWebhookConfig();
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const mock = createBitrixMockPinnedRequest({
        [tasksUrl]: {
          body: {
            result: {
              tasks: [
                sampleValidBitrixTask({
                  ID: "9001",
                  DESCRIPTION: "Task without client label",
                  CHANGED_DATE: "2026-09-30T12:00:00+03:00",
                }),
              ],
            },
            total: 1,
          },
        },
        [checklistUrl]: {
          body: { result: [sampleChecklistRootGroup()], total: 1 },
        },
      });
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: mock.pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 403);
    if (sync.httpStatus === 403) {
      assert.match(sync.body.message, /не подтверждена/i);
    }
    assert.equal(mock.calls.filter(call => call.url === checklistUrl).length, 0);
    const cached = await requirePool().query(
      "SELECT title, published FROM bitrix24_task_cache WHERE task_id = '9001'",
    );
    assert.equal(cached.rows[0].title, "Pilot task");
    assert.equal(cached.rows[0].published, false);
  });

  for (const seeded of [false, true]) {
    it(`rejects a foreign source before writes/checklist HTTP (existing cache: ${seeded})`, async () => {
      const manager = await createTestUser({
        databaseUrl, email: "manager@example.com", password: TEST_PASSWORD,
        fullName: "Manager User", role: "manager",
      });
      await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
      const config = sampleWebhookConfig();
      if (seeded) {
        await seedResponsibleTask({ userId: manager.id, bitrixUserId: "42" });
      } else {
        await upsertEmployeePortalLink({
          userId: manager.id, portalId: config.portalId, bitrixUserId: "42",
        });
      }
      await linkCardToHolding(CLIENT_TWO, HOLDING_TWO);
      const foreignLabel = await issueLabelInTransaction("holding", HOLDING_TWO);
      const mock = createBitrixMockPinnedRequest({
        [`${config.webhookBaseUrl}tasks.task.list`]: { body: {
          result: { tasks: [sampleValidBitrixTask({
            ID: "9001", TITLE: "Foreign private title",
            DESCRIPTION: formatLabelToken(foreignLabel.labelCode),
            CHANGED_DATE: "2026-09-30T12:00:00+03:00",
          })] }, total: 1,
        } },
      });
      const sync = await runClientCardBitrix24Sync({
        context: accessContext(manager.id, "manager", MANAGER_A),
        cardGuid: CLIENT_ONE, objectType: "holding", objectGuid: HOLDING_ONE,
        holdingGuid: HOLDING_ONE, pinnedRequest: mock.pinnedRequest,
        resolvePortalAddresses: createSafePortalResolver(),
      });
      assert.equal(sync.httpStatus, 403);
      assert.equal(mock.calls.length, 1);
      const cached = await requirePool().query(
        "SELECT title, published FROM bitrix24_task_cache WHERE task_id = '9001'",
      );
      assert.equal(cached.rows.length, seeded ? 1 : 0);
      if (seeded) {
        assert.equal(cached.rows[0].title, "Pilot task");
        assert.equal(cached.rows[0].published, false);
      }
      const checklist = await requirePool().query("SELECT count(*)::int AS n FROM bitrix24_task_checklist_snapshots");
      assert.equal(checklist.rows[0].n, 0);
    });
  }

  it("rechecks user status after task HTTP and before publishing", async () => {
    const manager = await createTestUser({
      databaseUrl, email: "manager@example.com", password: TEST_PASSWORD,
      fullName: "Manager User", role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
    const { config, label } = await seedResponsibleTask({ userId: manager.id, bitrixUserId: "42" });
    const mock = createBitrixMockPinnedRequest({
      [`${config.webhookBaseUrl}tasks.task.list`]: async () => {
        await requirePool().query("UPDATE users SET status = 'disabled' WHERE id = $1", [manager.id]);
        return { body: { result: { tasks: [sampleValidBitrixTask({
          ID: "9001", TITLE: "Must not be saved", DESCRIPTION: formatLabelToken(label.labelCode),
          CHANGED_DATE: "2026-09-30T12:00:00+03:00",
        })] }, total: 1 } };
      },
    });
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE, objectType: "holding", objectGuid: HOLDING_ONE, holdingGuid: HOLDING_ONE,
      pinnedRequest: mock.pinnedRequest, resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 403);
    assert.equal(mock.calls.length, 1);
    assert.equal((await requirePool().query("SELECT title FROM bitrix24_task_cache")).rows[0].title, "Pilot task");
  });

  it("allows sync with stale cache for responsible employee on card", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
    const { label, config } = await seedResponsibleTask({
      userId: manager.id,
      bitrixUserId: "42",
      changedAt: "2026-09-30T08:00:00+03:00",
    });
    process.env.BITRIX24_CACHE_ACCESS_TTL_MS = "1000";
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE bitrix24_task_cache
       SET synced_at = NOW() - INTERVAL '2 hours'
       WHERE portal_id = $1 AND task_id = $2`,
      [config.portalId, "9001"],
    );
    await pool.end();

    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [tasksUrl]: {
          body: {
            result: {
              tasks: [
                sampleValidBitrixTask({
                  ID: "9001",
                  DESCRIPTION: formatLabelToken(label.labelCode),
                  CHANGED_DATE: "2026-09-30T12:00:00+03:00",
                }),
              ],
            },
            total: 1,
          },
        },
        [checklistUrl]: {
          body: { result: [sampleChecklistRootGroup()], total: 1 },
        },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.complete, true);
    }
  });

  it("releases advisory locks when batch acquire hits cooldown", async () => {
    await resetPoolForTests();
    process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS = "60000";
    const first = await acquireManualSyncLock("portal.batch", "9301", 60000);
    assert.equal(first.ok, true);
    if (first.ok) {
      await first.release();
    }
    const blocked = await acquireManualSyncLocks("portal.batch", ["9301", "9302"], 60000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.code, "COOLDOWN");
    }
    const parallel = await acquireManualSyncLock("portal.batch", "9302", 0);
    assert.equal(parallel.ok, true);
    if (parallel.ok) {
      await parallel.release();
    }
    delete process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS;
  });

  it("blocks concurrent locks for the same portal task", async () => {
    await resetPoolForTests();
    const first = await acquireManualSyncLock("portal.example", "9201", 0);
    assert.equal(first.ok, true);
    const second = await acquireManualSyncLock("portal.example", "9201", 0);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "SYNC_IN_PROGRESS");
    }
    if (first.ok) {
      await first.release();
    }
  });

  it("releases earlier locks when a later batch task is already locked", async () => {
    const busy = await acquireManualSyncLock("portal.batch", "9402", 0);
    assert.equal(busy.ok, true);
    const independent = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const result = await acquireManualSyncLocks("portal.batch", ["9401", "9402"], 0);
      assert.equal(result.ok, false);
      const probe = await independent.query(
        "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked",
        ["portal.batch", "manual_sync:9401"],
      );
      assert.equal(probe.rows[0].locked, true);
    } finally {
      await independent.end();
      if (busy.ok) await busy.release();
      await resetPoolForTests();
    }
  });

  it("destroys a connection on unlock error and makes release idempotent", async () => {
    const pool = requirePool();
    const client = await pool.connect();
    const originalQuery = client.query.bind(client);
    client.query = ((...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("pg_advisory_unlock(")) {
        return Promise.reject(new Error("simulated unlock transport failure"));
      }
      return (originalQuery as (...args: unknown[]) => unknown)(...args);
    }) as typeof client.query;
    client.release();
    const held = await acquireManualSyncLock("portal.unlock", "9403", 0);
    assert.equal(held.ok, true);
    if (held.ok) {
      await held.release();
      await held.release();
    }
    const independent = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const probe = await independent.query(
        "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked",
        ["portal.unlock", "manual_sync:9403"],
      );
      assert.equal(probe.rows[0].locked, true);
    } finally {
      await independent.end();
    }
  });

  it("enforces cooldown interval between runs", async () => {
    await resetPoolForTests();
    process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS = "60000";
    assert.equal(loadManualSyncMinIntervalMs(), 60000);
    const first = await acquireManualSyncLock("portal.example", "9202", 60000);
    assert.equal(first.ok, true);
    if (first.ok) {
      await first.release();
    }
    const second = await acquireManualSyncLock("portal.example", "9202", 60000);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "COOLDOWN");
      assert.ok(second.retryAfterMs > 0);
    }
    delete process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS;
  });

  it("reports partial result when Bitrix checklist returns 403", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
    const { label, config } = await seedResponsibleTask({
      userId: manager.id,
      bitrixUserId: "42",
    });
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [tasksUrl]: {
          body: {
            result: {
              tasks: [
                sampleValidBitrixTask({
                  ID: "9001",
                  DESCRIPTION: formatLabelToken(label.labelCode),
                  CHANGED_DATE: "2026-09-30T12:00:00+03:00",
                }),
              ],
            },
            total: 1,
          },
        },
        [checklistUrl]: { status: 403, body: { error: "ACCESS_DENIED" } },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.status, "partial");
      assert.equal(sync.body.complete, false);
      assert.match(sync.body.message, /частич/i);
    }
  });

  it("returns failed transport result on Bitrix task read timeout", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await linkManagerToEmployee(databaseUrl, manager.id, MANAGER_A);
    const { config } = await seedResponsibleTask({
      userId: manager.id,
      bitrixUserId: "42",
    });
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      env: {
        ...process.env,
        BITRIX24_ENABLED: "true",
        BITRIX24_WEBHOOK_URL: config.webhookBaseUrl,
        BITRIX24_REQUEST_TIMEOUT_MS: "1000",
        BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS: "0",
      },
      pinnedRequest: createBitrixMockPinnedRequest({
        [tasksUrl]: async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return { body: { result: { tasks: [] }, total: 0 } };
        },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.status, "failed");
      assert.equal(sync.body.complete, false);
      assert.match(sync.body.message, /ожидан/i);
    }
  });
});
