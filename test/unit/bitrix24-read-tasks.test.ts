import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import { mapBitrixTaskStatus, normalizeBitrixTask } from "../../src/bitrix24/normalize-task";
import { readBitrixTasksForUser } from "../../src/bitrix24/read-tasks";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";

describe("bitrix24 read tasks", () => {
  it("rejects invalid envelopes instead of treating them as empty success", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const cases = [
      {},
      { result: { tasks: "bad" }, total: 9 },
    ];

    for (const body of cases) {
      const { pinnedRequest } = createBitrixMockPinnedRequest({ [url]: { body } });
      const result = await readBitrixTasksForUser(config, "42", {
        operation: {
          deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
          pinnedRequest,
          resolvePortalAddresses: createSafePortalResolver(),
        },
        maxPages: 1,
      });
      assert.equal(result.ok, false, JSON.stringify(body));
    }
  });

  it("marks empty page with next as incomplete", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: { body: { result: { tasks: [] }, next: 50, total: 100 } },
    });
    const result = await readBitrixTasksForUser(config, "42", {
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        pinnedRequest,
        resolvePortalAddresses: createSafePortalResolver(),
      },
      maxPages: 1,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.complete, false);
      assert.equal(result.data.truncatedReason, "EMPTY_PAGE_WITH_NEXT");
    }
  });

  it("counts rejected invalid records and keeps sample partial", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: {
        body: {
          result: { tasks: [{}] },
          next: 50,
          total: 100,
        },
      },
    });
    const result = await readBitrixTasksForUser(config, "42", {
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        pinnedRequest,
        resolvePortalAddresses: createSafePortalResolver(),
      },
      maxPages: 1,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.tasks.length, 0);
      assert.equal(result.data.rejectedTaskCount, 1);
      assert.equal(result.data.complete, false);
      assert.equal(result.data.truncatedReason, "INVALID_RECORDS");
    }
  });

  it("paginates, deduplicates and marks max page truncation", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: (body: unknown) => {
        const start = (body as { start?: number }).start ?? 0;
        if (start === 0) {
          return {
            body: {
              result: {
                tasks: [
                  {
                    ID: "10",
                    TITLE: "A",
                    REAL_STATUS: 5,
                    RESPONSIBLE_ID: "42",
                    CREATED_BY: "7",
                    DEADLINE: "2026-09-30T12:00:00+03:00",
                    CHANGED_DATE: "2026-09-29T10:00:00+03:00",
                  },
                  {
                    ID: "10",
                    TITLE: "Dup",
                    REAL_STATUS: 5,
                    RESPONSIBLE_ID: "42",
                    CREATED_BY: "7",
                  },
                ],
              },
              next: 50,
              total: 3,
            },
          };
        }
        return {
          body: {
            result: {
              tasks: [
                {
                  ID: "11",
                  TITLE: "B",
                  REAL_STATUS: 2,
                  RESPONSIBLE_ID: "42",
                  CREATED_BY: "7",
                },
              ],
            },
            next: 100,
            total: 3,
          },
        };
      },
    });

    const partial = await readBitrixTasksForUser(config, "42", {
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        pinnedRequest,
        resolvePortalAddresses: createSafePortalResolver(),
      },
      maxPages: 1,
    });
    assert.equal(partial.ok, true);
    if (partial.ok) {
      assert.equal(partial.data.tasks.length, 1);
      assert.equal(partial.data.complete, false);
      assert.equal(partial.data.truncatedReason, "MAX_PAGES");
    }
  });

  it("prioritizes REAL_STATUS over STATUS and rejects invalid ids", () => {
    const task = normalizeBitrixTask("example.bitrix24.ru", {
      id: "1",
      status: "2",
      realStatus: "5",
      responsibleId: "42",
      createdBy: "7",
    });
    assert.ok(task);
    assert.equal(task?.statusLabel, "completed");
    assert.equal(mapBitrixTaskStatus("999"), "unknown");
    assert.equal(normalizeBitrixTask("host", { id: true }), null);
    assert.equal(normalizeBitrixTask("host", { id: "000" }), null);
  });
});
