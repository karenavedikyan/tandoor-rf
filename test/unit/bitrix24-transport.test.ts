import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callBitrix24Method } from "../../src/bitrix24/transport";
import { createBitrixMockFetch, sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";

const safeLookup = async () => ({ address: "93.184.216.34", family: 4 });

describe("bitrix24 transport", () => {
  it("rejects disallowed methods", async () => {
    const config = sampleWebhookConfig();
    const result = await callBitrix24Method(
      config,
      "crm.lead.list" as "user.get",
      {},
      { lookup: safeLookup },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "METHOD_NOT_ALLOWED");
    }
  });

  it("blocks redirect responses", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}user.get`;
    const { fetchImpl } = createBitrixMockFetch({
      [url]: { redirect: true },
    });
    const result = await callBitrix24Method(config, "user.get", {}, { fetchImpl, lookup: safeLookup });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "REDIRECT_BLOCKED");
    }
  });

  it("maps HTTP 401 to unauthorized", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}user.get`;
    const { fetchImpl } = createBitrixMockFetch({
      [url]: { status: 401, body: { error: "INVALID_CREDENTIALS" } },
    });
    const result = await callBitrix24Method(config, "user.get", {}, { fetchImpl, lookup: safeLookup });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "UNAUTHORIZED");
    }
  });

  it("maps API error inside HTTP 200", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}tasks.task.list`;
    const { fetchImpl } = createBitrixMockFetch({
      [url]: { body: { error: "insufficient_scope", error_description: "Need task scope" } },
    });
    const result = await callBitrix24Method(config, "tasks.task.list", {}, { fetchImpl, lookup: safeLookup });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "FORBIDDEN");
    }
  });

  it("does not leak webhook token in request URL construction only to configured base", async () => {
    const config = sampleWebhookConfig();
    const url = `${config.webhookBaseUrl}user.get`;
    const { fetchImpl, calls } = createBitrixMockFetch({
      [url]: { body: { result: [] } },
    });
    await callBitrix24Method(config, "user.get", { filter: { ID: "42" } }, { fetchImpl, lookup: safeLookup });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /^https:\/\/example\.bitrix24\.ru\/rest\/1\/abc123secret\/user\.get$/);
  });
});
