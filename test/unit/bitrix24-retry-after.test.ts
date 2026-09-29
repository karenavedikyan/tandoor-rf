import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import { callBitrix24Method, parseRetryAfterMs } from "../../src/bitrix24/transport";
import { createSafePortalResolver, sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";
import type { PinnedRequestFn } from "../../src/bitrix24/pinned-request";

describe("bitrix24 retry-after", () => {
  it("does not cap Retry-After above 60 seconds", () => {
    assert.equal(parseRetryAfterMs({ "retry-after": "120" }, Date.now()), 120_000);
  });

  it("waits full Retry-After when it fits the shared deadline", async () => {
    const config = { ...sampleWebhookConfig(), maxTotalDurationMs: 300_000 };
    const url = `${config.webhookBaseUrl}user.get`;
    const sleeps: number[] = [];
    let attempts = 0;

    const pinnedRequest: PinnedRequestFn = async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          statusCode: 429,
          headers: { "retry-after": "120" },
          body: JSON.stringify({ error: "QUERY_LIMIT_EXCEEDED" }),
        };
      }
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ result: [] }),
      };
    };

    await callBitrix24Method(
      config,
      "user.get",
      {},
      {
        pinnedRequest,
        operation: {
          deadline: OperationDeadline.fromDuration(
            config.maxTotalDurationMs,
            Date.now(),
            async (ms) => {
              sleeps.push(ms);
            },
          ),
          resolvePortalAddresses: createSafePortalResolver(),
        },
      },
    );

    assert.deepEqual(sleeps, [120_000]);
    assert.equal(attempts, 2);
  });

  it("honors Retry-After on HTTP 200 rate-limit body", async () => {
    const config = { ...sampleWebhookConfig(), maxTotalDurationMs: 300_000 };
    const sleeps: number[] = [];
    let attempts = 0;

    const pinnedRequest: PinnedRequestFn = async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          statusCode: 200,
          headers: { "retry-after": "90" },
          body: JSON.stringify({ error: "QUERY_LIMIT_EXCEEDED" }),
        };
      }
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ result: [] }),
      };
    };

    await callBitrix24Method(
      config,
      "user.get",
      {},
      {
        pinnedRequest,
        operation: {
          deadline: OperationDeadline.fromDuration(
            config.maxTotalDurationMs,
            Date.now(),
            async (ms) => {
              sleeps.push(ms);
            },
          ),
          resolvePortalAddresses: createSafePortalResolver(),
        },
      },
    );

    assert.deepEqual(sleeps, [90_000]);
    assert.equal(attempts, 2);
  });
});
