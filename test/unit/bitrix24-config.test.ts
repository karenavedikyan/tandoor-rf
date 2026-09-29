import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBitrix24Enabled, loadBitrix24Config } from "../../src/bitrix24/config";

describe("bitrix24 config", () => {
  it("is disabled by default", () => {
    assert.equal(isBitrix24Enabled({ BITRIX24_ENABLED: "false" }), false);
    assert.equal(isBitrix24Enabled({}), false);
  });

  it("loads webhook configuration when enabled", () => {
    const loaded = loadBitrix24Config({
      BITRIX24_ENABLED: "true",
      BITRIX24_WEBHOOK_URL: "https://example.bitrix24.ru/rest/12/abcDEF123/",
    });
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.config.portalHost, "example.bitrix24.ru");
      assert.equal(loaded.config.webhookUserId, "12");
      assert.equal(loaded.config.webhookToken, "abcDEF123");
    }
  });

  it("rejects non-https webhook URLs", () => {
    const loaded = loadBitrix24Config({
      BITRIX24_ENABLED: "true",
      BITRIX24_WEBHOOK_URL: "http://example.bitrix24.ru/rest/1/token/",
    });
    assert.equal(loaded.ok, false);
  });

  it("rejects localhost portal hosts", () => {
    const loaded = loadBitrix24Config({
      BITRIX24_ENABLED: "true",
      BITRIX24_WEBHOOK_URL: "https://localhost/rest/1/token/",
    });
    assert.equal(loaded.ok, false);
  });

  it("rejects mismatched portal host override", () => {
    const loaded = loadBitrix24Config({
      BITRIX24_ENABLED: "true",
      BITRIX24_WEBHOOK_URL: "https://example.bitrix24.ru/rest/1/token/",
      BITRIX24_PORTAL_HOST: "other.bitrix24.ru",
    });
    assert.equal(loaded.ok, false);
  });
});
