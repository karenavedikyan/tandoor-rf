import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import { issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import { runLabelsBulkBootstrap } from "../../src/bitrix24/labels/bulk-bootstrap";
import { runClientCardBitrix24Sync } from "../../src/bitrix24/sync/client-card-sync";
import { findCardObjectMapping } from "../../src/bitrix24/tasks/card-objects";
import {
  findPublishedTaskById,
  findTaskSnapshotById,
  listPublishedTaskIdsForResponsibleScope,
  unpublishResponsibleTasksNotInSet,
  upsertEmployeePortalLink,
  upsertTaskSnapshot,
} from "../../src/bitrix24/tasks/repository";
import { requirePool } from "../../src/db/pool";
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
    const after = await runLabelsBulkBootstrap("dry_run");
    assert.equal(after.counters.cardLinksCreated, before.counters.cardLinksCreated);
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

  it("unpublish respects pre-sync snapshot and keeps tasks published after snapshot", async () => {
    const label = await issueLabelInTransaction("holding", HOLDING_ONE);
    const config = sampleWebhookConfig();
    for (const taskId of ["88100", "88101"]) {
      await upsertTaskSnapshot({
        portalId: config.portalId,
        taskId,
        responsibleBitrixUserId: "42",
        title: `Task ${taskId}`,
        statusLabel: "in_progress",
        deadline: null,
        changedAt: "2026-09-30T10:00:00+03:00",
        descriptionHash: `hash-${taskId}`,
        published: true,
        objectType: "holding",
        objectGuid: HOLDING_ONE,
        labelCode: label.labelCode,
        bindingStatus: "confirmed",
        conflictReason: null,
        linkedAt: new Date().toISOString(),
      });
    }
    const snapshot = await listPublishedTaskIdsForResponsibleScope({
      portalId: config.portalId,
      bitrixUserId: "42",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
    });
    assert.deepEqual(snapshot.sort(), ["88100", "88101"]);
    await unpublishResponsibleTasksNotInSet({
      portalId: config.portalId,
      bitrixUserId: "42",
      objectType: "holding",
      objectGuid: HOLDING_ONE,
      holdingGuid: HOLDING_ONE,
      snapshotTaskIds: ["88100"],
      keepTaskIds: [],
    });
    assert.equal((await findTaskSnapshotById(config.portalId, "88100"))?.published, false);
    assert.equal((await findPublishedTaskById(config.portalId, "88101"))?.published, true);
  });
});
