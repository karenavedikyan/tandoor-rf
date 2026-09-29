import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runBitrix24Probe } from "../../src/bitrix24/probe";
import { createBitrixMockFetch, sampleWebhookConfig } from "../helpers/bitrix24-mock-fetch";

const safeLookup = async () => ({ address: "93.184.216.34", family: 4 });

describe("bitrix24 probe", () => {
  it("returns disabled without touching network", async () => {
    const result = await runBitrix24Probe({ env: { BITRIX24_ENABLED: "false" } });
    assert.equal(result.status, "DISABLED");
  });

  it("returns local ok for valid config without live flag", async () => {
    const result = await runBitrix24Probe({
      env: {
        BITRIX24_ENABLED: "true",
        BITRIX24_WEBHOOK_URL: "https://example.bitrix24.ru/rest/1/abc123secret/",
      },
    });
    assert.equal(result.status, "LOCAL_OK");
    assert.equal(result.portalId, "example.bitrix24.ru");
  });

  it("requires explicit user id for live mode", async () => {
    const result = await runBitrix24Probe({
      env: {
        BITRIX24_ENABLED: "true",
        BITRIX24_WEBHOOK_URL: "https://example.bitrix24.ru/rest/1/abc123secret/",
      },
      live: true,
    });
    assert.equal(result.status, "LIVE_REQUIRES_USER");
  });

  it("returns success for live limited sample without leaking secrets or task text", async () => {
    const config = sampleWebhookConfig();
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { fetchImpl } = createBitrixMockFetch({
      [userUrl]: {
        body: { result: [{ ID: "42", ACTIVE: true, NAME: "Secret Name", EMAIL: "secret@example.com" }] },
      },
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              { ID: "10", TITLE: "Secret task title", REAL_STATUS: 5, RESPONSIBLE_ID: "42", CREATED_BY: "7" },
            ],
          },
          total: 1,
        },
      },
    });

    const result = await runBitrix24Probe({
      env: {
        BITRIX24_ENABLED: "true",
        BITRIX24_WEBHOOK_URL: config.webhookBaseUrl,
      },
      live: true,
      bitrixUserId: "42",
      fetchImpl,
      lookup: safeLookup,
    });

    assert.equal(result.status, "SUCCESS");
    assert.equal(result.tasksFetched, 1);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /abc123secret/);
    assert.doesNotMatch(serialized, /Secret task title/);
    assert.doesNotMatch(serialized, /Secret Name/);
    assert.doesNotMatch(serialized, /secret@example.com/);
  });
});
