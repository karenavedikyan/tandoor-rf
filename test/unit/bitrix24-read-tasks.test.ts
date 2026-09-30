import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import { mapBitrixTaskStatus, normalizeBitrixTask } from "../../src/bitrix24/normalize-task";
import { readBitrixTasksForUser } from "../../src/bitrix24/read-tasks";
import { runBitrix24Probe } from "../../src/bitrix24/probe";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";

function operation(config: ReturnType<typeof sampleWebhookConfig>, pinnedRequest: unknown) {
  return {
    deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
    pinnedRequest,
    resolvePortalAddresses: createSafePortalResolver(),
  };
}

describe("bitrix24 read tasks completeness", () => {
  it("marks mixed valid/invalid page as partial with rejected count", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: {
        body: {
          result: {
            tasks: [sampleValidBitrixTask(), {}],
          },
          total: 2,
        },
      },
    });
    const result = await readBitrixTasksForUser(config, "42", {
      operation: operation(config, pinnedRequest),
      maxPages: 1,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.tasks.length, 1);
      assert.equal(result.data.rejectedTaskCount, 1);
      assert.equal(result.data.complete, false);
      assert.equal(result.data.truncatedReason, "INVALID_RECORDS");
    }

    const userUrl = `${config.webhookBaseUrl}user.get`;
    const { pinnedRequest: probePinned } = createBitrixMockPinnedRequest({
      [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
      [url]: {
        body: {
          result: {
            tasks: [sampleValidBitrixTask(), {}],
          },
          total: 2,
        },
      },
    });
    const probe = await runBitrix24Probe({
      env: {
        BITRIX24_ENABLED: "true",
        BITRIX24_WEBHOOK_URL: config.webhookBaseUrl,
      },
      live: true,
      bitrixUserId: "42",
      pinnedRequest: probePinned,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(probe.status, "PARTIAL");
    assert.equal(probe.tasksComplete, false);
  });

  it("marks empty list with contradictory total as incomplete", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: { body: { result: { tasks: [] }, total: 9 } },
    });
    const result = await readBitrixTasksForUser(config, "42", {
      operation: operation(config, pinnedRequest),
      maxPages: 1,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.tasks.length, 0);
      assert.equal(result.data.complete, false);
      assert.equal(result.data.truncatedReason, "TOTAL_MISMATCH");
    }
  });

  it("does not claim fields_checked when only id is present", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
      [url]: { body: { result: { tasks: [{ id: "1" }] }, total: 1 } },
    });
    const result = await readBitrixTasksForUser(config, "42", {
      operation: operation(config, pinnedRequest),
      maxPages: 1,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.tasks.length, 0);
      assert.equal(result.data.fieldsValidatedOnSample, false);
      assert.equal(result.data.rejectedTaskCount, 1);
    }

    const probe = await runBitrix24Probe({
      env: {
        BITRIX24_ENABLED: "true",
        BITRIX24_WEBHOOK_URL: config.webhookBaseUrl,
      },
      live: true,
      bitrixUserId: "42",
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(probe.status, "PARTIAL");
    assert.doesNotMatch(probe.checks.join(","), /fields_checked/);
  });

  it("accepts valid empty result and unknown status with optional deadline", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask({
                REAL_STATUS: 999,
                DEADLINE: null,
              }),
            ],
          },
          total: 1,
        },
      },
    });
    const result = await readBitrixTasksForUser(config, "42", {
      operation: operation(config, pinnedRequest),
      maxPages: 1,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.complete, true);
      assert.equal(result.data.tasks[0]?.statusLabel, "unknown");
      assert.equal(result.data.tasks[0]?.deadline, null);
      assert.equal(result.data.fieldsValidatedOnSample, true);
    }
  });

  it("rejects invalid envelopes instead of treating them as empty success", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    for (const body of [{}, { result: { tasks: "bad" }, total: 9 }]) {
      const { pinnedRequest } = createBitrixMockPinnedRequest({ [url]: { body } });
      const result = await readBitrixTasksForUser(config, "42", {
        operation: operation(config, pinnedRequest),
        maxPages: 1,
      });
      assert.equal(result.ok, false, JSON.stringify(body));
    }
  });

  it("prioritizes REAL_STATUS over STATUS and rejects invalid ids", () => {
    const task = normalizeBitrixTask("example.bitrix24.ru", {
      id: "1",
      title: "Task",
      status: "2",
      realStatus: "5",
      responsibleId: "42",
      createdBy: "7",
      changedDate: "2026-09-29T10:00:00+03:00",
    });
    assert.ok(task);
    assert.equal(task?.statusLabel, "completed");
    assert.equal(mapBitrixTaskStatus("999"), "unknown");
    assert.equal(normalizeBitrixTask("host", { id: true }), null);
    assert.equal(normalizeBitrixTask("host", { id: "000" }), null);
  });
});
