import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import { issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import { runLabelsBulkBootstrap } from "../../src/bitrix24/labels/bulk-bootstrap";
import { runClientCardBitrix24Sync } from "../../src/bitrix24/sync/client-card-sync";
import { findCardObjectMapping } from "../../src/bitrix24/tasks/card-objects";
import {
  beginManualSyncCardSession,
  MANUAL_SYNC_ADMISSION_SLOT_COUNT,
} from "../../src/bitrix24/sync/manual-sync-lock";
import {
  findPublishedTaskById,
  findTaskSnapshotById,
  listPublishedTaskSnapshotForResponsibleScope,
  unpublishResponsibleTasksNotInSet,
  upsertEmployeePortalLink,
  findEmployeePortalLink,
  recordEmployeePortalVerification,
  clearEmployeePortalVerification,
  upsertTaskSnapshot,
} from "../../src/bitrix24/tasks/repository";
import { requirePool, resetPoolForTests } from "../../src/db/pool";
import request from "supertest";
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
  createResponsibleTaskListHandler,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";
import { HOLDING_ONE, HOLDING_TWO, linkCardToHolding } from "../helpers/bitrix24-card-fixtures";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";
import { sampleChecklistRootGroup } from "../helpers/bitrix24-checklist-fixtures";
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
const MANAGER_A = "22222222-2222-4222-8222-222222222222";

describe("bitrix24 working mode integration", { concurrency: false }, () => {
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
    process.env.BITRIX24_PILOT_ALLOWLIST_REQUIRED = "true";
    process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS = "0";
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
    await insertSyntheticClients(databaseUrl, [
      {
        guid_client: CLIENT_ONE,
        name_client: "Client One",
        guid_manager: MANAGER_A,
        name_manager: "Manager A",
        guid_holding: HOLDING_ONE,
        name_holding: "Holding One",
      },
    ]);
    await linkCardToHolding(CLIENT_ONE, HOLDING_ONE);
  });

  after(() => {
    delete process.env.BITRIX24_TASKS_MODE;
    delete process.env.BITRIX24_LINK_VERIFICATION_TTL_MS;
  });

  it("discovers new labeled task without pilot allowlist", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "manager@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager User",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const token = formatLabelToken(label.labelCode);
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [userUrl]: {
          body: { result: [{ ID: "42", ACTIVE: true }] },
        },
        [tasksUrl]: {
          body: {
            result: {
              tasks: [
                sampleValidBitrixTask({
                  ID: "88001",
                  DESCRIPTION: token,
                  CHANGED_DATE: "2026-09-30T12:00:00+03:00",
                }),
              ],
            },
            total: 1,
          },
        },
        [checklistUrl]: {
          body: {
            result: [{ ...sampleChecklistRootGroup(), TASK_ID: "88001" }],
            total: 1,
          },
        },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.complete, true);
      assert.ok(sync.body.tasksSynced >= 1);
    }
  });

  it("bulk bootstrap dry-run does not mutate card links", async () => {
    const before = await runLabelsBulkBootstrap("dry_run");
    assert.equal(before.mode, "dry_run");
    assert.ok(before.counters.clientsScanned >= 1);
    assert.ok(before.fingerprint.length >= 32);
    assert.ok(before.actions.length >= 1);
    const after = await runLabelsBulkBootstrap("dry_run");
    assert.equal(after.counters.cardLinksCreated, before.counters.cardLinksCreated);
    assert.equal(after.fingerprint, before.fingerprint);
  });

  it("refreshes stale verification without changing confirmed identity", async () => {
    const user = await createTestUser({ databaseUrl, email: "stale-refresh@example.com",
      password: TEST_PASSWORD, fullName: "Stale", role: "admin" });
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({ userId: user.id, portalId: config.portalId, bitrixUserId: "42" });
    await requirePool().query(`UPDATE bitrix24_employee_portal_links SET confirmed_at = NOW() - INTERVAL '2 days',
      last_verified_at = NOW() - INTERVAL '2 days' WHERE user_id = $1`, [user.id]);
    const before = await findEmployeePortalLink(user.id, config.portalId);
    await issueLabelInTransaction("holding", HOLDING_ONE);
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(user.id, "admin"), cardGuid: CLIENT_ONE,
      objectType: "holding", objectGuid: HOLDING_ONE, holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [`${config.webhookBaseUrl}user.get`]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
        [`${config.webhookBaseUrl}tasks.task.list`]: { body: { result: { tasks: [] }, total: 0 } },
      }).pinnedRequest, resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    const after = await findEmployeePortalLink(user.id, config.portalId);
    assert.equal(after?.confirmedAt, before?.confirmedAt);
    assert.notEqual(after?.lastVerifiedAt, before?.lastVerifiedAt);
  });

  it("rejects a late verification clear after a newer verification", async () => {
    const user = await createTestUser({ databaseUrl, email: "verify-cas@example.com",
      password: TEST_PASSWORD, fullName: "CAS", role: "admin" });
    const portalId = sampleWebhookConfig().portalId;
    await upsertEmployeePortalLink({ userId: user.id, portalId, bitrixUserId: "42" });
    const previous = await findEmployeePortalLink(user.id, portalId);
    assert.ok(previous);
    assert.equal(await recordEmployeePortalVerification(user.id, portalId, previous), true);
    await clearEmployeePortalVerification(user.id, portalId, previous);
    assert.ok((await findEmployeePortalLink(user.id, portalId))?.lastVerifiedAt);
  });

  it("does not bootstrap a revoked holding or its missing card mapping", async () => {
    const pool = requirePool();
    await issueLabelInTransaction("holding", HOLDING_ONE);
    await pool.query("UPDATE bitrix24_object_labels SET revoked_at = NOW() WHERE object_guid = $1", [HOLDING_ONE]);
    await pool.query("DELETE FROM bitrix24_client_card_objects WHERE card_guid = $1", [CLIENT_ONE]);
    const user = await createTestUser({ databaseUrl, email: "bootstrap-revoked@example.com",
      password: TEST_PASSWORD, fullName: "Admin", role: "admin" });
    const preview = await runLabelsBulkBootstrap("dry_run");
    assert.equal(preview.counters.cardLinksCreated, 0);
    await runLabelsBulkBootstrap("apply", user.id, preview.fingerprint);
    assert.equal(await findCardObjectMapping(CLIENT_ONE), null);
  });

  it("rolls back all bootstrap writes on a later SQL failure and records a failed audit", async () => {
    const pool = requirePool();
    await pool.query("DELETE FROM bitrix24_client_card_objects WHERE card_guid = $1", [CLIENT_ONE]);
    const user = await createTestUser({ databaseUrl, email: "bootstrap-rollback@example.com",
      password: TEST_PASSWORD, fullName: "Admin", role: "admin" });
    await pool.query(`CREATE FUNCTION test_bootstrap_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic card write failure'; END $$;
      CREATE TRIGGER test_bootstrap_fail BEFORE INSERT ON bitrix24_client_card_objects
      FOR EACH ROW EXECUTE FUNCTION test_bootstrap_fail()`);
    try {
      const preview = await runLabelsBulkBootstrap("dry_run");
      await assert.rejects(runLabelsBulkBootstrap("apply", user.id, preview.fingerprint));
      assert.equal(Number((await pool.query("SELECT count(*) AS n FROM bitrix24_object_labels")).rows[0].n), 0);
      assert.equal(await findCardObjectMapping(CLIENT_ONE), null);
      assert.equal((await pool.query("SELECT status FROM bitrix24_labels_bootstrap_audit")).rows[0]?.status, "failed");
    } finally {
      await pool.query("DROP TRIGGER test_bootstrap_fail ON bitrix24_client_card_objects; DROP FUNCTION test_bootstrap_fail()");
    }
  });

  it("reports failed discovery when tasks.task.list returns 403", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wm403@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager 403",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
        [tasksUrl]: { status: 403, body: { error: "ACCESS_DENIED" } },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.status, "failed");
      assert.equal(sync.body.complete, false);
      assert.equal(sync.body.tasksSynced, 0);
      assert.match(sync.body.message, /Bitrix24/i);
    }
    void label;
  });

  it("returns cooldown 429 before Bitrix HTTP on immediate repeat", async () => {
    process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS = "60000";
    const manager = await createTestUser({
      databaseUrl,
      email: "wmcool@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Cooldown",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const token = formatLabelToken(label.labelCode);
    const mock = createBitrixMockPinnedRequest({
      [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                ID: "88002",
                DESCRIPTION: token,
                CHANGED_DATE: "2026-09-30T12:00:00+03:00",
              }),
            ],
          },
          total: 1,
        },
      },
      [checklistUrl]: {
        body: { result: [{ ...sampleChecklistRootGroup(), TASK_ID: "88002" }], total: 1 },
      },
    });
    let httpCalls = 0;
    const countingRequest: typeof mock.pinnedRequest = async (options) => {
      httpCalls += 1;
      return mock.pinnedRequest(options);
    };
    const first = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: countingRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(first.httpStatus, 200);
    const callsAfterFirst = httpCalls;
    assert.ok(callsAfterFirst > 0);
    httpCalls = 0;
    const second = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: countingRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(second.httpStatus, 429);
    assert.equal(httpCalls, 0);
    delete process.env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS;
  });

  it("reports partial when one of two discovered tasks fails checklist fetch", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wmpartial@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Partial",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    const token = formatLabelToken(label.labelCode);
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
        [tasksUrl]: (body: unknown) => {
          const filter = (body as { filter?: { ID?: string } }).filter;
          const tasks = [
            sampleValidBitrixTask({
              ID: "88010",
              DESCRIPTION: token,
              CHANGED_DATE: "2026-09-30T12:00:00+03:00",
            }),
            sampleValidBitrixTask({
              ID: "88011",
              DESCRIPTION: token,
              CHANGED_DATE: "2026-09-30T12:01:00+03:00",
            }),
          ];
          const scoped = filter?.ID
            ? tasks.filter((task) => String(task.ID) === String(filter.ID))
            : tasks;
          return {
            body: { result: { tasks: scoped }, total: scoped.length },
          };
        },
        [checklistUrl]: (body: unknown) => {
          const parsed = body as { TASKID?: number | string };
          if (String(parsed.TASKID) === "88011") {
            return { status: 403, body: { error: "ACCESS_DENIED" } };
          }
          return {
            body: { result: [{ ...sampleChecklistRootGroup(), TASK_ID: "88010" }], total: 1 },
          };
        },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.status, "partial");
      assert.equal(sync.body.complete, false);
      assert.equal(sync.body.tasksSynced, 2);
      assert.equal(sync.body.checklistsSynced, 1);
    }
  });

  it("reports success with zero tasks when discovery finds none", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wmzero@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Zero",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
        [tasksUrl]: { body: { result: { tasks: [] }, total: 0 } },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.status, "success");
      assert.equal(sync.body.tasksSynced, 0);
      assert.match(sync.body.message, /не найдены/i);
    }
  });

  it("denies sync when employee portal access is expired", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wmexp@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Expired",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
      accessExpiresAt: "2020-01-01T00:00:00.000Z",
    });
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({}).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 403);
    if (sync.httpStatus === 403) {
      assert.equal(sync.body.code, "ACCESS_EXPIRED");
    }
  });

  it("rejects inactive Bitrix user and does not refresh verification", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wminactive@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Inactive",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [userUrl]: { body: { result: [{ ID: "42", ACTIVE: false }] } },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 403);
    if (sync.httpStatus === 403) {
      assert.equal(sync.body.code, "BITRIX_USER_INACTIVE");
    }
    const row = await requirePool().query<{ last_verified_at: Date | null }>(
      `SELECT last_verified_at FROM bitrix24_employee_portal_links WHERE user_id = $1::uuid`,
      [manager.id],
    );
    assert.equal(row.rows[0]?.last_verified_at, null);
  });

  it("bootstrap apply with card link conflict does not mutate mapping", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wmboot@example.com",
      password: TEST_PASSWORD,
      fullName: "Bootstrap Manager",
      role: "admin",
    });
    await linkCardToHolding(CLIENT_ONE, HOLDING_TWO);
    const result = await runLabelsBulkBootstrap("apply", manager.id);
    assert.equal(result.applied, false);
    assert.ok(result.conflicts.length >= 1);
    const mapping = await findCardObjectMapping(CLIENT_ONE);
    assert.equal(mapping?.objectGuid, HOLDING_TWO);
  });

  it("unpublish CAS respects cache_version and keeps newer generation published", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "88101",
      responsibleBitrixUserId: "42",
      title: "Task v1",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T10:00:00+03:00",
      descriptionHash: "hash-v1",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });
    const snapshot = await listPublishedTaskSnapshotForResponsibleScope({
      portalId: config.portalId,
      bitrixUserId: "42",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
    });
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0]?.cacheVersion, 1);
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "88101",
      responsibleBitrixUserId: "42",
      title: "Task v2",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T13:00:00+03:00",
      descriptionHash: "hash-v2",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });
    await unpublishResponsibleTasksNotInSet({
      portalId: config.portalId,
      bitrixUserId: "42",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      snapshotEntries: snapshot,
      keepTaskIds: [],
    });
    assert.equal((await findPublishedTaskById(config.portalId, "88101"))?.published, true);
    assert.equal((await findTaskSnapshotById(config.portalId, "88101"))?.cacheVersion, 2);
  });

  it("discovery ignores %DESCRIPTION filter and matches labels server-side", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wmdisc@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Discovery",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    const token = formatLabelToken(label.labelCode);
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const checklistUrl = `${config.webhookBaseUrl}task.checklistitem.getlist`;
    const sync = await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
        [tasksUrl]: createResponsibleTaskListHandler(
          [
            sampleValidBitrixTask({
              ID: "88200",
              RESPONSIBLE_ID: "42",
              DESCRIPTION: token,
              CHANGED_DATE: "2026-09-30T12:00:00+03:00",
            }),
            sampleValidBitrixTask({
              ID: "88201",
              RESPONSIBLE_ID: "42",
              DESCRIPTION: "Task without card label",
              CHANGED_DATE: "2026-09-30T12:00:00+03:00",
            }),
          ],
          "42",
        ),
        [checklistUrl]: {
          body: { result: [{ ...sampleChecklistRootGroup(), TASK_ID: "88200" }], total: 1 },
        },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(sync.httpStatus, 200);
    if (sync.httpStatus === 200) {
      assert.equal(sync.body.tasksSynced, 1);
    }
  });

  it("denies cache API read after inactive Bitrix user clears verification", async () => {
    const manager = await createTestUser({
      databaseUrl,
      email: "wmcache@example.com",
      password: TEST_PASSWORD,
      fullName: "Manager Cache",
      role: "manager",
    });
    await linkUserToEmployee({
      databaseUrl,
      userId: manager.id,
      employeeId: MANAGER_A,
      confirmedByUserId: manager.id,
    });
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    await upsertEmployeePortalLink({
      userId: manager.id,
      portalId: config.portalId,
      bitrixUserId: "42",
    });
    await upsertTaskSnapshot({
      portalId: config.portalId,
      taskId: "88300",
      responsibleBitrixUserId: "42",
      title: "Cached task",
      statusLabel: "in_progress",
      deadline: null,
      changedAt: "2026-09-30T12:00:00+03:00",
      descriptionHash: "hash",
      published: true,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      labelCode: label.labelCode,
      bindingStatus: "confirmed",
      conflictReason: null,
      linkedAt: new Date().toISOString(),
    });
    await requirePool().query(
      `UPDATE bitrix24_employee_portal_links SET last_verified_at = NOW()
       WHERE user_id = $1::uuid`,
      [manager.id],
    );
    const userUrl = `${config.webhookBaseUrl}user.get`;
    await runClientCardBitrix24Sync({
      context: accessContext(manager.id, "manager", MANAGER_A),
      cardGuid: CLIENT_ONE,
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      pinnedRequest: createBitrixMockPinnedRequest({
        [userUrl]: { body: { result: [{ ID: "42", ACTIVE: false }] } },
      }).pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "wmcache@example.com", password: TEST_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const res = await request(app)
      .get(`/api/clients/${CLIENT_ONE}/bitrix24/tasks?objectType=holding&objectGuid=${HOLDING_ONE}`)
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body?.tasks) ? res.body.tasks.length : res.body?.items?.length ?? 0, 0);
  });

  it("limits concurrent card sessions without exhausting the pool", async () => {
    await resetPoolForTests();
    const cardIds = [
      "11111111-1111-4111-8111-111111111101",
      "11111111-1111-4111-8111-111111111102",
      "11111111-1111-4111-8111-111111111103",
    ];
    const sessions = [];
    for (let i = 0; i < MANUAL_SYNC_ADMISSION_SLOT_COUNT; i += 1) {
      const user = await createTestUser({
        databaseUrl,
        email: `admission${i}@example.com`,
        password: TEST_PASSWORD,
        fullName: `Admission ${i}`,
        role: "manager",
      });
      const session = await beginManualSyncCardSession(
        "portal.admission",
        cardIds[i]!,
        user.id,
        0,
      );
      assert.equal(session.ok, true);
      sessions.push(session);
    }
    const blockedUser = await createTestUser({
      databaseUrl,
      email: "admission-blocked@example.com",
      password: TEST_PASSWORD,
      fullName: "Admission Blocked",
      role: "manager",
    });
    const blocked = await beginManualSyncCardSession(
      "portal.admission",
      "33333333-3333-4333-8333-333333333333",
      blockedUser.id,
      0,
      { admissionDeadlineMs: Date.now() + 100 },
    );
    assert.equal(blocked.ok, false);
    const probe = await requirePool().query("SELECT 1 AS ok");
    assert.equal(probe.rows[0]?.ok, 1);
    for (const session of sessions) {
      if (session.ok) {
        await session.release();
      }
    }
  });
});
