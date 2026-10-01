import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import type { Pool as PgPool } from "pg";
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
  grantClientAccess,
  linkUserToEmployee,
} from "../helpers/access-db-fixtures";
import { insertSyntheticClients } from "../helpers/clients-db-fixtures";
import { sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";
import { HOLDING_ONE, linkCardToHolding } from "../helpers/bitrix24-card-fixtures";
import { insertSummaryPublication } from "../helpers/bitrix24-work-fixtures";
import { upsertChecklistSnapshot } from "../../src/bitrix24/tasks/checklist-repository";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "22222222-2222-4222-8222-222222222222";
const MANAGER_A = "33333333-3333-4333-8333-333333333333";
const MANAGER_B = "44444444-4444-4444-8444-444444444444";
const ASSISTANT_EMP = "55555555-5555-4555-8555-555555555555";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: ORIGIN };
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

async function readTaskCacheGeneration(
  dbUrl: string,
  portalId: string,
  taskId: string,
): Promise<{ cacheVersion: number; syncedAt: string }> {
  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  const row = await pool.query<{ cache_version: number; synced_at: Date }>(
    `SELECT cache_version, synced_at FROM bitrix24_task_cache
     WHERE portal_id = $1 AND task_id = $2`,
    [portalId, taskId],
  );
  await pool.end();
  const found = row.rows[0];
  assert.ok(found);
  return {
    cacheVersion: Number(found.cache_version),
    syncedAt: found.synced_at.toISOString(),
  };
}

async function login(email: string): Promise<string> {
  const app = await loadApp();
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

function wrapQueryCounter(): { getCount: () => number; restore: () => void } {
  const { getPool } = require("../../src/db/pool") as { getPool: () => PgPool };
  const pool = getPool();
  let count = 0;
  const original = pool.query.bind(pool);
  pool.query = (async (...args: Parameters<PgPool["query"]>) => {
    count += 1;
    return original(...args);
  }) as PgPool["query"];
  return {
    getCount: () => count,
    restore: () => {
      pool.query = original;
    },
  };
}

describe("my work queue integration", { concurrency: false }, () => {
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
    process.env.BITRIX24_LINK_VERIFICATION_TTL_MS = "3600000";
    process.env.BITRIX24_TASKS_MODE = "working";
    process.env.BITRIX24_PILOT_TASK_IDS = "";
    process.env.BITRIX24_PILOT_ALLOWLIST_REQUIRED = "false";
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Alpha Client",
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
        guid_holding: HOLDING_ONE,
        name_holding: "Holding One",
      },
      {
        guid_client: CLIENT_TWO,
        name_client: "Beta Client",
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
        guid_holding: HOLDING_ONE,
        name_holding: "Holding One",
      },
    ]);
    await linkCardToHolding(CLIENT_ONE, HOLDING_ONE);
    await linkCardToHolding(CLIENT_TWO, HOLDING_ONE);
  });

  after(() => {
    delete process.env.BITRIX24_ENABLED;
    delete process.env.BITRIX24_WEBHOOK_URL;
    delete process.env.BITRIX24_CACHE_PUBLISH_ENABLED;
    delete process.env.BITRIX24_CACHE_ACCESS_TTL_MS;
    delete process.env.BITRIX24_LINK_VERIFICATION_TTL_MS;
    delete process.env.BITRIX24_TASKS_MODE;
    delete process.env.BITRIX24_PILOT_TASK_IDS;
    delete process.env.BITRIX24_PILOT_ALLOWLIST_REQUIRED;
  });

  async function seedTask(input: {
    taskId: string;
    title: string;
    responsibleBitrixUserId: string;
    responsibleUserId: string;
    statusLabel?: string;
    deadline?: string | null;
    briefText?: string;
    checklist?: boolean;
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
      taskId: input.taskId,
      responsibleBitrixUserId: input.responsibleBitrixUserId,
      title: input.title,
      statusLabel: input.statusLabel ?? "in_progress",
      deadline: input.deadline ?? null,
      changedAt: "2026-09-30T12:00:00+03:00",
      descriptionHash: "hash-" + input.taskId,
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
        taskId: input.taskId,
        objectType: "holding",
        objectGuid: HOLDING_ONE,
        briefText: input.briefText,
        publishedByUserId: admin.rows[0]!.id,
      });
    }
    if (input.checklist) {
      const generation = await readTaskCacheGeneration(databaseUrl, config.portalId, input.taskId);
      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const client = await pool.connect();
      try {
        await upsertChecklistSnapshot(
          {
            portalId: config.portalId,
            taskId: input.taskId,
            objectType: "holding",
            objectGuid: HOLDING_ONE,
            loadStatus: "loaded",
            syncComplete: true,
            items: [
              {
                itemId: "1",
                taskId: input.taskId,
                title: "Step one",
                parentId: null,
                sortIndex: 1,
                isComplete: true,
                coExecutorBitrixIds: [],
                isRootGroup: false,
              },
            ],
            taskCacheVersion: generation.cacheVersion,
            taskSyncedAt: generation.syncedAt,
          },
          client,
        );
      } finally {
        client.release();
        await pool.end();
      }
    }
    return config;
  }

  it("deduplicates one task across two client cards", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-dedupe@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Dedupe",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await seedTask({
      taskId: "91001",
      title: "Shared task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
    });
    const app = await loadApp();
    const cookie = await login("mgr-dedupe@example.com");
    const res = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0]?.taskId, "91001");
    assert.equal(res.body.items[0]?.clients?.length, 2);
  });

  it("finds holding task by second accessible card filter", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-hold@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Hold",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await seedTask({
      taskId: "91011",
      title: "Holding via Beta",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
    });
    const app = await loadApp();
    const cookie = await login("mgr-hold@example.com");
    const filtered = await request(app)
      .get("/api/work/tasks?clientGuid=" + CLIENT_TWO)
      .set(authHeaders(cookie));
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.items[0]?.taskId, "91011");
    assert.ok(filtered.body.items[0]?.clients.some((c: { clientGuid: string }) => c.clientGuid === CLIENT_TWO));
  });

  it("does not leak foreign task title via search or counts", async () => {
    const managerA = await createTestUser({
      databaseUrl,
      email: "mgr-a@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager A Owner",
      role: "manager",
    });
    const viewer = await createTestUser({
      databaseUrl,
      email: "viewer@example.com",
      password: TEST_PASSWORD,
      fullName: "Regional Viewer",
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
      userId: viewer.id,
      employeeId: MANAGER_B,
      confirmedByUserId: managerA.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: viewer.id,
      objectId: CLIENT_ONE,
      grantedByUserId: managerA.id,
    });
    await upsertEmployeePortalLink({
      userId: viewer.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "99",
    });
    await seedTask({
      taskId: "91002",
      title: "Secret full title XYZ",
      responsibleBitrixUserId: "42",
      responsibleUserId: managerA.id,
      briefText: "Visible brief ABC",
    });
    const app = await loadApp();
    const cookie = await login("viewer@example.com");
    const list = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0]?.accessLevel, "summary");
    assert.equal(list.body.items[0]?.briefText, "Visible brief ABC");
    assert.equal(list.body.items[0]?.checklist, undefined);
    const searchSecret = await request(app)
      .get("/api/work/tasks?q=Secret+full+title")
      .set(authHeaders(cookie));
    assert.equal(searchSecret.body.total, 0);
    const searchBrief = await request(app)
      .get("/api/work/tasks?q=Visible+brief")
      .set(authHeaders(cookie));
    assert.equal(searchBrief.body.total, 1);
    assert.equal(searchBrief.body.counts.no_deadline, 1);
  });

  it("keeps all five deadline counters with open list and completed chip", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-counts@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Counts",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const todayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await seedTask({
      taskId: "91003",
      title: "Overdue task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
      deadline: "2000-01-01T10:00:00+03:00",
    });
    await seedTask({
      taskId: "91004",
      title: "Today task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
      deadline: `${todayKey}T18:00:00+03:00`,
    });
    await seedTask({
      taskId: "91004b",
      title: "Completed task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
      statusLabel: "completed",
      deadline: "2000-01-01T10:00:00+03:00",
    });
    const app = await loadApp();
    const cookie = await login("mgr-counts@example.com");

    const openList = await request(app).get("/api/work/tasks?status=open").set(authHeaders(cookie));
    assert.equal(openList.body.counts.overdue, 1);
    assert.equal(openList.body.counts.today, 1);
    assert.equal(openList.body.counts.completed, 1);
    assert.equal(openList.body.total, 2);

    const completedChip = await request(app)
      .get("/api/work/tasks?deadlineGroup=completed&status=all")
      .set(authHeaders(cookie));
    assert.equal(completedChip.body.total, 1);
    assert.equal(completedChip.body.counts.overdue, 1);
    assert.equal(completedChip.body.counts.today, 1);
    assert.equal(completedChip.body.counts.completed, 1);

    const backOpen = await request(app).get("/api/work/tasks?status=open").set(authHeaders(cookie));
    assert.equal(backOpen.body.counts.completed, 1);
    assert.equal(backOpen.body.total, 2);
  });

  it("paginates with stable ordering", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-page@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Page",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    for (let i = 0; i < 3; i += 1) {
      await seedTask({
        taskId: "9200" + i,
        title: "Task " + i,
        responsibleBitrixUserId: "42",
        responsibleUserId: manager.id,
        deadline: "2026-09-30T1" + i + ":00:00+03:00",
      });
    }
    const app = await loadApp();
    const cookie = await login("mgr-page@example.com");
    const page1 = await request(app)
      .get("/api/work/tasks?page=1&pageSize=2")
      .set(authHeaders(cookie));
    assert.equal(page1.body.total, 3);
    assert.equal(page1.body.items.length, 2);
    const page2 = await request(app)
      .get("/api/work/tasks?page=2&pageSize=2")
      .set(authHeaders(cookie));
    assert.equal(page2.body.items.length, 1);
    assert.notEqual(page1.body.items[0]?.taskId, page2.body.items[0]?.taskId);
  });

  it("uses bounded SQL regardless of candidate count", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-sql@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager SQL",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    for (let i = 0; i < 3; i += 1) {
      await seedTask({
        taskId: "930" + i,
        title: "SQL task " + i,
        responsibleBitrixUserId: "42",
        responsibleUserId: manager.id,
      });
    }
    const app = await loadApp();
    const cookie = await login("mgr-sql@example.com");
    const smallCounter = wrapQueryCounter();
    let smallCount = 0;
    try {
      await request(app).get("/api/work/tasks?page=1&pageSize=5").set(authHeaders(cookie));
      smallCount = smallCounter.getCount();
    } finally {
      smallCounter.restore();
    }

    for (let i = 3; i < 15; i += 1) {
      await seedTask({
        taskId: "930" + i,
        title: "SQL task " + i,
        responsibleBitrixUserId: "42",
        responsibleUserId: manager.id,
      });
    }
    const largeCounter = wrapQueryCounter();
    try {
      const res = await request(app)
        .get("/api/work/tasks?page=1&pageSize=5")
        .set(authHeaders(cookie));
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 15);
      const largeCount = largeCounter.getCount();
      assert.ok(
        largeCount <= smallCount + 4,
        `expected sublinear SQL (${smallCount} -> ${largeCount})`,
      );
    } finally {
      largeCounter.restore();
    }
  });

  it("denies queue when employee portal verification is cleared", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-deny@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Deny",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await seedTask({
      taskId: "91005",
      title: "Cached task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
    });
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE bitrix24_employee_portal_links SET last_verified_at = NULL
       WHERE user_id = $1::uuid`,
      [manager.id],
    );
    await pool.end();
    const app = await loadApp();
    const cookie = await login("mgr-deny@example.com");
    const res = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(res.body.state, "access_expired");
    assert.equal(res.body.items.length, 0);
  });

  it("allows assistant delegation before expiry and hides after", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-del@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Del",
      role: "manager",
    });
    const assistant = await createTestUser({
      databaseUrl,
      email: "asst@example.com",
      password: TEST_PASSWORD,
      fullName: "Assistant",
      role: "assistant",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: assistant.id,
      employeeId: ASSISTANT_EMP,
      confirmedByUserId: manager.id,
    });
    await upsertEmployeePortalLink({
      userId: assistant.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "42",
    });
    await seedTask({
      taskId: "91006",
      title: "Delegated task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
    });
    await createDelegationRecord({
      databaseUrl,
      delegatorUserId: manager.id,
      assistantUserId: assistant.id,
      clientGuids: [CLIENT_ONE],
      status: "active",
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      approvedByUserId: manager.id,
    });
    const app = await loadApp();
    const cookie = await login("asst@example.com");
    const active = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(active.body.total, 1);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `UPDATE delegations SET ends_at = NOW() - INTERVAL '1 hour' WHERE assistant_user_id = $1::uuid`,
      [assistant.id],
    );
    await pool.end();
    const expired = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(expired.body.total, 0);
  });

  it("shares contact mark with card API binding", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-contact@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Contact",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await seedTask({
      taskId: "91007",
      title: "Contact task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
    });
    const app = await loadApp();
    const cookie = await login("mgr-contact@example.com");
    await request(app)
      .put(`/api/clients/${CLIENT_ONE}/bitrix24/tasks/91007/contact`)
      .set({ ...authHeaders(cookie), "Content-Type": "application/json" })
      .send({ marked: true, comment: "Написал" });
    const work = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(work.body.items[0]?.contactAction?.marked, true);
    assert.equal(work.body.items[0]?.contactAction?.comment, "Написал");
    await request(app)
      .put(`/api/clients/${CLIENT_TWO}/bitrix24/tasks/91007/contact`)
      .set({ ...authHeaders(cookie), "Content-Type": "application/json" })
      .send({ marked: false });
    const cleared = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(cleared.body.items[0]?.contactAction?.marked, false);
  });

  it("returns checklist progress without items tree in list API", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-cl@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager CL",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await seedTask({
      taskId: "91008",
      title: "Checklist task",
      responsibleBitrixUserId: "42",
      responsibleUserId: manager.id,
      checklist: true,
    });
    const app = await loadApp();
    const cookie = await login("mgr-cl@example.com");
    const work = await request(app).get("/api/work/tasks").set(authHeaders(cookie));
    assert.equal(work.body.items[0]?.checklist?.state, "ready");
    assert.equal(work.body.items[0]?.checklist?.progress?.total, 1);
    assert.equal(work.body.items[0]?.checklist?.items, undefined);
    const card = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(card.body.tasks[0]?.checklist?.items?.length, 1);
  });
});
