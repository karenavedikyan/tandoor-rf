import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import { normalizeBitrixTask } from "../../src/bitrix24/normalize-task";
import { readBitrixTasksForUser } from "../../src/bitrix24/read-tasks";
import { runBitrix24Probe } from "../../src/bitrix24/probe";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";
import { sampleValidBitrixTask } from "../helpers/bitrix24-task-fixtures";

const baseRecord = {
  id: "1",
  title: "Task",
  responsibleId: "42",
  createdBy: "7",
  changedDate: "2026-09-29T10:00:00+03:00",
};

describe("bitrix24 task status normalization", () => {
  it("rejects boolean, object and array status values", () => {
    for (const status of [true, { bad: true }, []]) {
      assert.equal(normalizeBitrixTask("host", { ...baseRecord, status }), null);
    }
  });

  it("rejects corrupted REAL_STATUS even when STATUS is valid", () => {
    assert.equal(
      normalizeBitrixTask("host", {
        ...baseRecord,
        realStatus: true,
        status: "2",
      }),
      null,
    );
  });

  it("accepts unknown typed status code and preserves statusRaw", () => {
    const task = normalizeBitrixTask("host", {
      ...baseRecord,
      realStatus: "999",
    });
    assert.ok(task);
    assert.equal(task?.statusRaw, "999");
    assert.equal(task?.statusLabel, "unknown");
  });

  it("falls back from null REAL_STATUS to STATUS and supports uppercase/camelCase", () => {
    const fromNullReal = normalizeBitrixTask("host", {
      ...baseRecord,
      REAL_STATUS: null,
      STATUS: "2",
    });
    assert.ok(fromNullReal);
    assert.equal(fromNullReal?.statusRaw, "2");
    assert.equal(fromNullReal?.statusLabel, "waiting");

    const camelCase = normalizeBitrixTask("host", {
      ...baseRecord,
      realStatus: "5",
      status: "2",
    });
    assert.ok(camelCase);
    assert.equal(camelCase?.statusRaw, "5");
    assert.equal(camelCase?.statusLabel, "completed");
  });

  it("marks mixed valid and corrupted status page as PARTIAL through probe", async () => {
    const config = sampleWebhookConfig();
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              sampleValidBitrixTask(),
              {
                ID: "11",
                TITLE: "Bad status task",
                STATUS: true,
                RESPONSIBLE_ID: "42",
                CREATED_BY: "7",
                CHANGED_DATE: "2026-09-29T10:00:00+03:00",
              },
            ],
          },
          total: 2,
        },
      },
    });

    const readResult = await readBitrixTasksForUser(config, "42", {
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        pinnedRequest,
        resolvePortalAddresses: createSafePortalResolver(),
      },
      maxPages: 1,
    });
    assert.equal(readResult.ok, true);
    if (readResult.ok) {
      assert.equal(readResult.data.tasks.length, 1);
      assert.equal(readResult.data.rejectedTaskCount, 1);
      assert.equal(readResult.data.complete, false);
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
    assert.equal(probe.tasksComplete, false);
  });

  it("keeps SUCCESS for fully valid control sample", async () => {
    const config = sampleWebhookConfig();
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
      [tasksUrl]: {
        body: {
          result: { tasks: [sampleValidBitrixTask()], total: 1 },
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
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });
    assert.equal(probe.status, "SUCCESS");
    assert.equal(probe.tasksComplete, true);
  });
});
