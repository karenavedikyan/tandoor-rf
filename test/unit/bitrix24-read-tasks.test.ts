import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBitrixTasksForUser } from "../../src/bitrix24/read-tasks";
import { createBitrixMockFetch, sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";

const safeLookup = async () => ({ address: "93.184.216.34", family: 4 });

describe("bitrix24 read tasks", () => {
  it("paginates, deduplicates and marks incomplete samples", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { fetchImpl } = createBitrixMockFetch({
      [url]: (body: unknown) => {
        const start = (body as { start?: number }).start ?? 0;
        if (start === 0) {
          return {
            body: {
              result: {
                tasks: [
                  { ID: "10", TITLE: "A", REAL_STATUS: 5, RESPONSIBLE_ID: "42", CREATED_BY: "7", DEADLINE: "2026-09-30T12:00:00+03:00", CHANGED_DATE: "2026-09-29T10:00:00+03:00" },
                  { ID: "10", TITLE: "Dup", REAL_STATUS: 5, RESPONSIBLE_ID: "42", CREATED_BY: "7", DEADLINE: null, CHANGED_DATE: "2026-09-29T10:00:00+03:00" },
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
                { ID: "11", TITLE: "B", REAL_STATUS: 2, RESPONSIBLE_ID: "42", CREATED_BY: "7", DEADLINE: "", CHANGED_DATE: "2026-09-28T10:00:00+03:00" },
              ],
            },
            next: 100,
            total: 3,
          },
        };
      },
    });

    const partial = await readBitrixTasksForUser(config, "42", {
      fetchImpl,
      lookup: safeLookup,
      maxPages: 1,
    });
    assert.equal(partial.ok, true);
    if (partial.ok) {
      assert.equal(partial.data.tasks.length, 1);
      assert.equal(partial.data.complete, false);
      assert.equal(partial.data.truncatedReason, "MAX_PAGES");
    }

    const complete = await readBitrixTasksForUser(config, "42", {
      fetchImpl,
      lookup: safeLookup,
      maxPages: 2,
    });
    assert.equal(complete.ok, true);
    if (complete.ok) {
      assert.equal(complete.data.tasks.length, 2);
      assert.equal(complete.data.tasks[0]?.statusLabel, "completed");
      assert.equal(complete.data.tasks[1]?.statusLabel, "waiting");
      assert.equal(complete.data.complete, false);
      assert.equal(complete.data.truncatedReason, "MAX_PAGES");
    }
  });

  it("rejects invalid user id", async () => {
    const result = await readBitrixTasksForUser(sampleWebhookConfig(), "abc", {
      lookup: safeLookup,
    });
    assert.equal(result.ok, false);
  });

  it("maps unknown status without guessing", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { fetchImpl } = createBitrixMockFetch({
      [url]: {
        body: {
          result: {
            tasks: [
              { ID: "99", TITLE: "Unknown", REAL_STATUS: 999, RESPONSIBLE_ID: "42", CREATED_BY: "7" },
            ],
          },
        },
      },
    });
    const result = await readBitrixTasksForUser(config, "42", { fetchImpl, lookup: safeLookup, maxPages: 1 });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.tasks[0]?.statusLabel, "unknown");
    }
  });
});
