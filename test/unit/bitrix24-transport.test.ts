import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OperationDeadline } from "../../src/bitrix24/deadline";
import { callBitrix24Method } from "../../src/bitrix24/transport";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";

describe("bitrix24 transport", () => {
  it("rejects disallowed methods", async () => {
    const config = sampleWebhookConfig();
    const result = await callBitrix24Method(
      config,
      "crm.lead.list" as "user.get",
      {},
      { pinnedRequest: createBitrixMockPinnedRequest({}).pinnedRequest },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "METHOD_NOT_ALLOWED");
    }
  });

  it("uses pinned address for the HTTPS request", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}user.get`;
    const { pinnedRequest, calls } = createBitrixMockPinnedRequest({
      [url]: { body: { result: [] } },
    });
    const resolvePortalAddresses = createSafePortalResolver("93.184.216.34");

    await callBitrix24Method(
      config,
      "user.get",
      { filter: { ID: "42" } },
      {
        pinnedRequest,
        operation: {
          deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
          resolvePortalAddresses,
        },
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.pinned.address, "93.184.216.34");
    assert.match(calls[0]!.url, /\/user\.get$/);
  });

  it("blocks redirect responses", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}user.get`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: { redirect: true },
    });
    const result = await callBitrix24Method(config, "user.get", {}, {
      pinnedRequest,
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        resolvePortalAddresses: createSafePortalResolver(),
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "REDIRECT_BLOCKED");
    }
  });

  it("maps HTTP 401 to unauthorized without external text", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}user.get`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: {
        status: 401,
        body: {
          error: "INVALID_CREDENTIALS",
          error_description: "Secret User <secret@example.com>",
        },
      },
    });
    const result = await callBitrix24Method(config, "user.get", {}, {
      pinnedRequest,
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs),
        resolvePortalAddresses: createSafePortalResolver(),
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "UNAUTHORIZED");
      assert.doesNotMatch(result.message, /secret@example.com/);
    }
  });

  it("respects total deadline for Retry-After backoff", async () => {
    const config = { ...sampleWebhookConfig(), maxTotalDurationMs: 1000, requestTimeoutMs: 500 };
    const url = `${config.webhookBaseUrl}user.get`;
    let attempts = 0;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [url]: () => {
        attempts += 1;
        return {
          status: 429,
          headers: { "retry-after": "2" },
          body: { error: "QUERY_LIMIT_EXCEEDED" },
        };
      },
    });

    const startedAt = Date.now();
    const result = await callBitrix24Method(config, "user.get", {}, {
      pinnedRequest,
      operation: {
        deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs, startedAt),
        resolvePortalAddresses: createSafePortalResolver(),
      },
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(result.ok, false);
    assert.ok(elapsed < 1500, `expected deadline-bound return, got ${elapsed}ms`);
    assert.ok(attempts <= 2);
  });
});
