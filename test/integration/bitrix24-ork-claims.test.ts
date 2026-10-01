import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import { issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import { readBitrixTasksForUser } from "../../src/bitrix24/read-tasks";
import { createOperationContext } from "../../src/bitrix24/transport";
import { runBitrix24TaskSync } from "../../src/bitrix24/sync/run-sync";
import { syncOrkPublicationFromDescription } from "../../src/bitrix24/claims/ork-publication-sync";
import { parseOrkSummaryFromDescription } from "../../src/bitrix24/claims/ork-parser";
import { upsertEmployeePortalLink, upsertTaskSnapshot } from "../../src/bitrix24/tasks/repository";
import { findActiveSummaryPublicationMeta } from "../../src/bitrix24/tasks/work-repository";
import { resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
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
} from "../helpers/bitrix24-checklist-fixtures";
import { insertSummaryPublication } from "../helpers/bitrix24-work-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_ONE = "11111111-1111-4111-8111-111111111111";
const CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";

function authHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
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
  labelCode: string;
}) {
  const config = sampleWebhookConfig();
  await upsertEmployeePortalLink({
    userId: input.userId,
    portalId: config.portalId,
    bitrixUserId: "42",
  });
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
    labelCode: input.labelCode,
    bindingStatus: "confirmed",
    conflictReason: null,
    linkedAt: new Date().toISOString(),
  });
  return config;
}

async function syncDescription(input: {
  managerId: string;
  description: string;
  changedAt?: string;
}) {
  const config = sampleWebhookConfig();
  const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
  const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
  return runBitrix24TaskSync({
    bitrixUserId: "42",
    apply: true,
    taskId: "9001",
    syncExecutorUserId: input.managerId,
    pinnedRequest: createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9001",
                DESCRIPTION: input.description,
                CHANGED_DATE: input.changedAt ?? "2026-09-30T12:00:00+03:00",
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
    }).pinnedRequest,
    resolvePortalAddresses: createSafePortalResolver(),
  });
}

describe("bitrix24 #орк claims integration", { concurrency: false }, () => {
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
    process.env.BITRIX24_LINK_VERIFICATION_TTL_MS = "3600000";
    process.env.BITRIX24_PORTAL_PUBLIC_URL = "https://example.bitrix24.ru";
    process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS = "60000";
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
    delete process.env.BITRIX24_LINK_VERIFICATION_TTL_MS;
    delete process.env.BITRIX24_PORTAL_PUBLIC_URL;
    delete process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS;
  });

  it("syncOrkPublication inserts when binding and parser succeed", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-direct@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Direct",
      role: "manager",
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    await seedResponsibleTask({ userId: manager.id, labelCode: label.labelCode });
    const config = sampleWebhookConfig();
    const description =
      formatLabelToken(label.labelCode) + "\n#орк Прямая публикация";
    assert.equal(parseOrkSummaryFromDescription(description).ok, true);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const meta = await client.query<{ cache_version: number }>(
        `SELECT cache_version FROM bitrix24_task_cache WHERE portal_id = $1 AND task_id = $2`,
        [config.portalId, "9001"],
      );
      const action = await syncOrkPublicationFromDescription(
        {
          portalId: config.portalId,
          taskId: "9001",
          objectType: "holding",
          objectGuid: HOLDING_ONE,
          bindingStatus: "confirmed",
          description,
          taskCacheVersion: Number(meta.rows[0]!.cache_version),
          syncExecutorUserId: manager.id,
          publishAllowed: true,
        },
        client,
      );
      await client.query("COMMIT");
      assert.notEqual(action.action, "none");
    } finally {
      client.release();
      await pool.end();
    }
    const active = await findActiveSummaryPublicationMeta(config.portalId, "9001");
    assert.ok(active);
    assert.equal(active!.publicationOrigin, "ork_sync");
  });

  it("publishes and updates #орк summary on sync", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-ork@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Ork",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    await seedResponsibleTask({ userId: manager.id, labelCode: label.labelCode });
    const description =
      formatLabelToken(label.labelCode) +
      "\nВнутреннее описание не должно попасть в сводку.\n#орк Рекламация принята.\nОжидаем поставку.";
    const config = sampleWebhookConfig();
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const pinned = createBitrixMockPinnedRequest({
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "9001",
                DESCRIPTION: description,
                CHANGED_DATE: "2026-09-30T12:00:00+03:00",
              }),
            ],
          },
          total: 1,
        },
      },
    }).pinnedRequest;
    const operation = createOperationContext(config);
    operation.pinnedRequest = pinned;
    const read = await readBitrixTasksForUser(config, "42", {
      taskId: "9001",
      operation,
    });
    assert.equal(read.ok, true);
    assert.ok(read.data!.tasks[0]!.description, "DESCRIPTION must be read from Bitrix mock");

    const sync = await syncDescription({
      managerId: manager.id,
      description,
    });
    assert.equal(sync.ok, true);
    assert.ok((sync.cacheWrites ?? 0) >= 1);

    const active = await findActiveSummaryPublicationMeta(config.portalId, "9001");
    assert.ok(active);
    assert.equal(active!.publicationOrigin, "ork_sync");
    assert.match(active!.briefText, /Рекламация принята/);
    assert.doesNotMatch(active!.briefText, /Внутреннее описание/);

    const app = await loadApp();
    const cookie = await login("mgr-ork@example.com");
    const claims = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/claims`)
      .set(authHeaders(cookie));
    assert.equal(claims.body.count, 1);
    assert.equal(claims.body.claims[0]?.briefText, active!.briefText);
    assert.equal(claims.body.claims[0]?.title, undefined);
    assert.equal(claims.body.claims[0]?.statusLabel, undefined);

    const tasks = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks`)
      .set(authHeaders(cookie));
    assert.equal(tasks.body.tasks[0]?.accessLevel, "full");
    assert.equal(JSON.stringify(tasks.body).includes("Внутреннее описание"), false);

    const updatedDescription =
      formatLabelToken(label.labelCode) +
      "\n#орк Обновлённая сводка.\nВторая строка.";
    const updateSync = await syncDescription({
      managerId: manager.id,
      description: updatedDescription,
      changedAt: "2026-09-30T12:30:00+03:00",
    });
    assert.equal(updateSync.ok, true);
    const updated = await findActiveSummaryPublicationMeta(config.portalId, "9001");
    assert.match(updated!.briefText, /Обновлённая сводка/);
  });

  it("revokes ork publication when tag is removed and keeps admin summaries", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-revoke@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Revoke",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    await seedResponsibleTask({ userId: manager.id, labelCode: label.labelCode });
    const config = sampleWebhookConfig();
    const withTag =
      formatLabelToken(label.labelCode) + "\n#орк Первая сводка";
    const firstSync = await syncDescription({ managerId: manager.id, description: withTag });
    assert.equal(firstSync.ok, true);

    await insertSummaryPublication({
      databaseUrl,
      portalId: config.portalId,
      taskId: "9002",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      briefText: "Admin-only summary",
      publishedByUserId: manager.id,
    });

    const withoutTag = formatLabelToken(label.labelCode) + "\nБез рекламации";
    const revokeSync = await syncDescription({
      managerId: manager.id,
      description: withoutTag,
      changedAt: "2026-09-30T13:00:00+03:00",
    });
    assert.equal(revokeSync.ok, true);

    const ork = await findActiveSummaryPublicationMeta(config.portalId, "9001");
    assert.equal(ork, null);
    const admin = await findActiveSummaryPublicationMeta(config.portalId, "9002");
    assert.equal(admin?.publicationOrigin, "admin");
    assert.equal(admin?.briefText, "Admin-only summary");
  });

  it("blocks duplicate tags and prefix lookalikes", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-dup@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Dup",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    await seedResponsibleTask({ userId: manager.id, labelCode: label.labelCode });
    const config = sampleWebhookConfig();
    const prefixSync = await syncDescription({
      managerId: manager.id,
      description: formatLabelToken(label.labelCode) + "\n#оркестр не считается",
    });
    assert.equal(prefixSync.ok, true);
    assert.equal(await findActiveSummaryPublicationMeta(config.portalId, "9001"), null);

    const dupSync = await syncDescription({
      managerId: manager.id,
      description: formatLabelToken(label.labelCode) + "\n#орк one\n#орк two",
      changedAt: "2026-09-30T14:00:00+03:00",
    });
    assert.equal(dupSync.ok, true);
    assert.equal(await findActiveSummaryPublicationMeta(config.portalId, "9001"), null);
  });

  it("shows ork claim to non-responsible card viewer without internal text leak", async () => {
    const viewer = await createTestUser({
      databaseUrl,
      email: "viewer-ork@example.com",
      password: TEST_PASSWORD,
      fullName: "Viewer Ork",
      role: "regional_manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: viewer.id,
      employeeId: MANAGER_B,
      confirmedByUserId: viewer.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: viewer.id,
      objectId: CLIENT_ONE,
      grantedByUserId: viewer.id,
    });
    await upsertEmployeePortalLink({
      userId: viewer.id,
      portalId: sampleWebhookConfig().portalId,
      bitrixUserId: "99",
    });
    const responsible = await createTestUser({
      databaseUrl,
      email: "resp-ork@example.com",
      password: TEST_PASSWORD,
      fullName: "Responsible Ork",
      role: "manager",
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    await seedResponsibleTask({ userId: responsible.id, labelCode: label.labelCode });
    const description =
      formatLabelToken(label.labelCode) +
      "\nСекретное описание.\n#орк Публичная сводка для клиента.";
    const sync = await syncDescription({ managerId: responsible.id, description });
    assert.equal(sync.ok, true);

    const app = await loadApp();
    const cookie = await login("viewer-ork@example.com");
    const claims = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/claims`)
      .set(authHeaders(cookie));
    assert.equal(claims.body.count, 1);
    assert.match(claims.body.claims[0]?.briefText, /Публичная сводка/);
    assert.equal(JSON.stringify(claims.body).includes("Секретное описание"), false);
    assert.equal(claims.body.claims[0]?.title, undefined);
  });

  it("does not expose admin summaries in claims feed", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Admin",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    await seedResponsibleTask({ userId: manager.id, labelCode: label.labelCode });
    const config = sampleWebhookConfig();
    await insertSummaryPublication({
      databaseUrl,
      portalId: config.portalId,
      taskId: "9001",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      briefText: "Admin-only summary",
      publishedByUserId: manager.id,
    });

    const app = await loadApp();
    const cookie = await login("mgr-admin@example.com");
    const claims = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/claims`)
      .set(authHeaders(cookie));
    assert.equal(claims.body.count, 0);
    assert.equal(JSON.stringify(claims.body).includes("Admin-only summary"), false);
  });

  it("ignores stale sync generation for ork publication writes", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "mgr-stale@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Stale",
      role: "manager",
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    await seedResponsibleTask({ userId: manager.id, labelCode: label.labelCode });
    const config = sampleWebhookConfig();
    const description = formatLabelToken(label.labelCode) + "\n#орк Актуальная сводка";
    const first = await syncDescription({ managerId: manager.id, description });
    assert.equal(first.ok, true);
    const active = await findActiveSummaryPublicationMeta(config.portalId, "9001");
    assert.ok(active);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const staleAction = await syncOrkPublicationFromDescription(
        {
          portalId: config.portalId,
          taskId: "9001",
          objectType: "holding",
          objectGuid: HOLDING_ONE,
          bindingStatus: "confirmed",
          description: formatLabelToken(label.labelCode) + "\n#орк Устаревшая попытка",
          taskCacheVersion: Math.max(1, (active!.taskCacheVersion ?? 1) - 1),
          syncExecutorUserId: manager.id,
          publishAllowed: true,
        },
        client,
      );
      await client.query("COMMIT");
      assert.equal(staleAction.action, "none");
    } finally {
      client.release();
      await pool.end();
    }

    const stillActive = await findActiveSummaryPublicationMeta(config.portalId, "9001");
    assert.match(stillActive!.briefText, /Актуальная сводка/);
  });
});
