import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTelegramGetMeResult,
  parseTelegramWebhookInfoResult,
  safeUnixSecondsToIso,
} from "../../src/tanbot-telegram/validate";
import { runTanbotTelegramProbe } from "../../src/tanbot-telegram/probe";
import type { TelegramTransportCall } from "../../src/tanbot-telegram/types";

const VALID_ENV = {
  TANBOT_TELEGRAM_ENABLED: "true",
  TANBOT_TELEGRAM_BOT_TOKEN: "123456789:SYNTH_VALIDATE_TOKEN_abcdefghijklmnopqrst",
  TANBOT_TELEGRAM_EXPECTED_USERNAME: "TANDOOR_IBOT",
};

const MIN_WEBHOOK = {
  url: "",
  has_custom_certificate: false,
  pending_update_count: 0,
};

describe("tanbot telegram validate (TB-DIAG-04)", () => {
  it("rejects malformed getMe payloads", () => {
    assert.equal(parseTelegramGetMeResult(null).ok, false);
    assert.equal(parseTelegramGetMeResult({ id: "1", is_bot: true }).ok, false);
    assert.equal(parseTelegramGetMeResult({ id: 1, is_bot: false }).ok, false);
  });

  it("requires mandatory webhook fields with correct types", () => {
    for (const raw of [null, 123, "bad", []]) {
      assert.equal(parseTelegramWebhookInfoResult(raw).ok, false, String(raw));
    }
    assert.equal(parseTelegramWebhookInfoResult({}).ok, false);
    assert.equal(
      parseTelegramWebhookInfoResult({
        has_custom_certificate: false,
        pending_update_count: 0,
      }).ok,
      false,
    );
    assert.equal(
      parseTelegramWebhookInfoResult({ url: "", pending_update_count: 0 }).ok,
      false,
    );
    assert.equal(
      parseTelegramWebhookInfoResult({ url: "", has_custom_certificate: false }).ok,
      false,
    );
    assert.equal(parseTelegramWebhookInfoResult({ url: 9, pending_update_count: -1 }).ok, false);

    const minimal = parseTelegramWebhookInfoResult(MIN_WEBHOOK);
    assert.equal(minimal.ok, true);
    if (minimal.ok) {
      assert.equal(minimal.info.url, "");
      assert.equal(minimal.info.pendingUpdateCount, 0);
    }
  });

  it("safeUnixSecondsToIso rejects extreme values", () => {
    assert.equal(safeUnixSecondsToIso(1e20), null);
    assert.equal(safeUnixSecondsToIso(-1), null);
    assert.ok(safeUnixSecondsToIso(1_700_000_000));
    assert.equal(
      parseTelegramWebhookInfoResult({ ...MIN_WEBHOOK, last_error_date: 1e20 }).ok,
      false,
    );
  });

  it("probe returns API_ERROR for invalid webhook upstream, not SUCCESS", async () => {
    const transport: TelegramTransportCall = async ({ method }) => {
      if (method === "getMe") {
        return { ok: true, result: { id: 1, is_bot: true, username: "TANDOOR_IBOT" } };
      }
      return { ok: true, result: {} };
    };
    const report = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    assert.equal(report.status, "API_ERROR");
    assert.equal(report.webhookConfigured, null);
  });
});
