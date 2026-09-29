import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import { readBitrixTasksForUser } from "../../src/bitrix24/read-tasks";
import { readBitrixUserById } from "../../src/bitrix24/read-users";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";

const CANARY = "private-title-person@example.invalid";

describe("bitrix24 read error canary", () => {
  it("readBitrixTasksForUser does not leak raw portal payload on INVALID_ENVELOPE", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: { body: { result: { tasks: CANARY }, total: 1 } },
    });
    const result = await readBitrixTasksForUser(config, "42", {
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        pinnedRequest,
        resolvePortalAddresses: createSafePortalResolver(),
      },
    });
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, new RegExp(CANARY.replace(".", "\\.")));
    assert.doesNotMatch(serialized, /"result"/);
    assert.doesNotMatch(serialized, /"transport"/);
  });

  it("readBitrixUserById does not leak raw portal payload on USER_NOT_FOUND", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}user.get`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: {
        body: {
          result: [{ ID: "99", ACTIVE: true, NAME: CANARY, EMAIL: CANARY }],
        },
      },
    });
    const result = await readBitrixUserById(config, "42", {
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        pinnedRequest,
        resolvePortalAddresses: createSafePortalResolver(),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "USER_NOT_FOUND");
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, new RegExp(CANARY.replace(".", "\\.")));
    assert.doesNotMatch(serialized, /"result"/);
    assert.doesNotMatch(serialized, /"transport"/);
  });
});
