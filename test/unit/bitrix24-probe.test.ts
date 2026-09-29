import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runBitrix24Probe } from "../../src/bitrix24/probe";
import {
  createBitrixMockPinnedRequest,
  createSafePortalResolver,
  sampleWebhookConfig,
} from "../helpers/bitrix24-mock-fetch";

describe("bitrix24 probe", () => {
  it("returns disabled without touching network", async () => {
    const result = await runBitrix24Probe({ env: { BITRIX24_ENABLED: "false" } });
    assert.equal(result.status, "DISABLED");
    assert.match(result.checkedAt, /Z$/);
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
    assert.doesNotMatch(result.checks.join(","), /fields_checked|pagination_checked/);
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

  it("does not leak secrets or personal data in live diagnostics output", async () => {
    const config = sampleWebhookConfig();
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [userUrl]: {
        body: {
          result: [{ ID: "42", ACTIVE: true, NAME: "Secret Name", EMAIL: "secret@example.com" }],
        },
      },
      [tasksUrl]: {
        body: {
          result: {
            tasks: [
              {
                ID: "10",
                TITLE: "Secret task title",
                REAL_STATUS: 5,
                RESPONSIBLE_ID: "42",
                CREATED_BY: "7",
              },
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
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });

    assert.equal(result.status, "SUCCESS");
    assert.equal(result.tasksFetched, 1);
    assert.ok(result.checks.includes("fields_checked"));
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /abc123secret/);
    assert.doesNotMatch(serialized, /Secret task title/);
    assert.doesNotMatch(serialized, /Secret Name/);
    assert.doesNotMatch(serialized, /secret@example.com/);
  });

  it("does not claim field checks on empty valid task sample", async () => {
    const config = sampleWebhookConfig();
    const userUrl = `${config.webhookBaseUrl}user.get`;
    const tasksUrl = `${config.webhookBaseUrl}tasks.task.list`;
    const { pinnedRequest } = createBitrixMockPinnedRequest({
      [userUrl]: { body: { result: [{ ID: "42", ACTIVE: true }] } },
      [tasksUrl]: { body: { result: { tasks: [] }, total: 0 } },
    });

    const result = await runBitrix24Probe({
      env: {
        BITRIX24_ENABLED: "true",
        BITRIX24_WEBHOOK_URL: config.webhookBaseUrl,
      },
      live: true,
      bitrixUserId: "42",
      pinnedRequest,
      resolvePortalAddresses: createSafePortalResolver(),
    });

    assert.equal(result.status, "SUCCESS");
    assert.doesNotMatch(result.checks.join(","), /fields_checked/);
  });
});
