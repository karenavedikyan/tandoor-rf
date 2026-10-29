import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runTanbotTelegramProbe } from "../../src/tanbot-telegram/probe";
import { formatDiagnosticReportForCli, publicExpectedUsername } from "../../src/tanbot-telegram/sanitize";
import type { TelegramTransportCall } from "../../src/tanbot-telegram/types";

const SYNTH_TOKEN = "123456789:SYNTH_TANBOT_TOKEN_LEAK_MARKER_abcdefghijklmnopqrst";
const MARKER_FRAGMENT = "SYNTH_TANBOT_TOKEN_LEAK";
const INTERNAL_URL = "https://internal-qa.invalid/hooks/secret-path?api_key=QA_PRIVATE_QUERY";

const VALID_ENV = {
  TANBOT_TELEGRAM_ENABLED: "true",
  TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
  TANBOT_TELEGRAM_EXPECTED_USERNAME: "TANDOOR_IBOT",
};

function mockTransport(
  handlers: Partial<Record<"getMe" | "getWebhookInfo", () => Promise<{ ok: true; result: unknown }>>>,
): TelegramTransportCall {
  return async ({ method }) => {
    const handler = handlers[method];
    if (!handler) throw new Error("unexpected method");
    return handler();
  };
}

describe("tanbot telegram security (TB-SEC-01)", () => {
  it("does not leak token fragment via truncated webhook error text", async () => {
    const padding = "x".repeat(170);
    const { transport } = (() => {
      const t = mockTransport({
        getMe: async () => ({
          ok: true,
          result: { id: 1, is_bot: true, username: "TANDOOR_IBOT" },
        }),
        getWebhookInfo: async () => ({
          ok: true,
          result: {
            url: "",
            has_custom_certificate: false,
            pending_update_count: 0,
            last_error_message: `${padding}${SYNTH_TOKEN}`,
            last_error_date: 1_700_000_000,
          },
        }),
      });
      return { transport: t };
    })();

    const report = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    assert.equal(report.status, "SUCCESS");
    const serialized = formatDiagnosticReportForCli(report);
    assert.doesNotMatch(serialized, new RegExp(MARKER_FRAGMENT));
    assert.doesNotMatch(serialized, /123456789:/);
    assert.match(report.lastWebhookErrorMessage ?? "", /details withheld/i);
  });

  it("does not echo secret placed in expected username env on CONFIG_ERROR", async () => {
    const report = await runTanbotTelegramProbe({
      env: {
        TANBOT_TELEGRAM_ENABLED: "true",
        TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
        TANBOT_TELEGRAM_EXPECTED_USERNAME: SYNTH_TOKEN,
      },
    });
    assert.equal(report.status, "CONFIG_ERROR");
    const serialized = formatDiagnosticReportForCli(report);
    assert.doesNotMatch(serialized, new RegExp(MARKER_FRAGMENT));
    assert.equal(report.expectedUsername, "TANDOOR_IBOT");
  });

  it("does not reflect internal webhook error URLs in diagnostics", async () => {
    const transport = mockTransport({
      getMe: async () => ({
        ok: true,
        result: { id: 1, is_bot: true, username: "TANDOOR_IBOT" },
      }),
      getWebhookInfo: async () => ({
        ok: true,
        result: {
          url: "",
          has_custom_certificate: false,
          pending_update_count: 0,
          last_error_message: `delivery failed ${INTERNAL_URL}`,
        },
      }),
    });
    const report = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    const serialized = formatDiagnosticReportForCli(report);
    assert.doesNotMatch(serialized, /internal-qa\.invalid/);
    assert.doesNotMatch(serialized, /QA_PRIVATE_QUERY/);
  });

  it("publicExpectedUsername rejects arbitrary env strings", () => {
    assert.equal(publicExpectedUsername(SYNTH_TOKEN), "TANDOOR_IBOT");
    assert.equal(publicExpectedUsername("TANDOOR_IBOT"), "TANDOOR_IBOT");
  });
});
