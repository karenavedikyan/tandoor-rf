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

describe("tanbot telegram validate (TB-DIAG-04)", () => {
  it("rejects malformed getMe payloads", () => {
    assert.equal(parseTelegramGetMeResult(null).ok, false);
    assert.equal(parseTelegramGetMeResult({ id: "1", is_bot: true }).ok, false);
    assert.equal(parseTelegramGetMeResult({ id: 1, is_bot: false }).ok, false);
  });

  it("rejects invalid webhook payload shapes", () => {
    for (const raw of [null, 123, "bad", []]) {
      assert.equal(parseTelegramWebhookInfoResult(raw).ok, false, String(raw));
    }
    assert.equal(parseTelegramWebhookInfoResult({}).ok, true);
    assert.equal(parseTelegramWebhookInfoResult({ url: 9, pending_update_count: -1 }).ok, false);
  });

  it("safeUnixSecondsToIso rejects extreme values", () => {
    assert.equal(safeUnixSecondsToIso(1e20), null);
    assert.equal(safeUnixSecondsToIso(-1), null);
    assert.ok(safeUnixSecondsToIso(1_700_000_000));
    assert.equal(parseTelegramWebhookInfoResult({ last_error_date: 1e20 }).ok, false);
  });

  it("probe returns API_ERROR for invalid webhook upstream, not SUCCESS", async () => {
    const transport: TelegramTransportCall = async ({ method }) => {
      if (method === "getMe") {
        return { ok: true, result: { id: 1, is_bot: true, username: "TANDOOR_IBOT" } };
      }
      return { ok: true, result: null };
    };
    const report = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    assert.equal(report.status, "API_ERROR");
    assert.equal(report.webhookConfigured, null);
  });
});
