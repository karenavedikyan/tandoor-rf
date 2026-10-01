import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { formatLabelToken } from "../../src/bitrix24/labels/format";
import { issueLabelInTransaction } from "../../src/bitrix24/labels/repository";
import { runLabelsBulkBootstrap } from "../../src/bitrix24/labels/bulk-bootstrap";
import { runClientCardBitrix24Sync } from "../../src/bitrix24/sync/client-card-sync";
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
});
