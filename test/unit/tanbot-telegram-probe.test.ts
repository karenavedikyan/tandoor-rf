import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runTanbotTelegramProbe } from "../../src/tanbot-telegram/probe";
import type { TelegramTransportCall, TelegramTransportResult } from "../../src/tanbot-telegram/types";
import { formatDiagnosticReportForCli } from "../../src/tanbot-telegram/sanitize";
import { buildTelegramMethodUrl } from "../../src/tanbot-telegram/transport";
import { parseTanbotTelegramProbeCliArgs } from "../../src/tanbot-telegram/cli-args";

const SYNTH_TOKEN = "123456789:SYNTH_TANBOT_TOKEN_LEAK_MARKER_abcdefghijklmnopqrst";
const VALID_ENV = {
  TANBOT_TELEGRAM_ENABLED: "true",
  TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
  TANBOT_TELEGRAM_EXPECTED_USERNAME: "TANDOOR_IBOT",
};

function mockTransport(
  handlers: Partial<
    Record<
      "getMe" | "getWebhookInfo",
      () => TelegramTransportResult | Promise<TelegramTransportResult>
    >
  >,
): { transport: TelegramTransportCall; calls: Array<{ method: string }> } {
  const calls: Array<{ method: string }> = [];
  const transport: TelegramTransportCall = async ({ method }) => {
    calls.push({ method });
    const handler = handlers[method];
    if (!handler) {
      return { ok: false, code: "API_ERROR", message: "Unexpected method in test." };
    }
    return handler();
  };
  return { transport, calls };
}

describe("tanbot telegram probe", () => {
  it("returns disabled without network", async () => {
    const { transport, calls } = mockTransport({});
    const result = await runTanbotTelegramProbe({
      env: { TANBOT_TELEGRAM_ENABLED: "false" },
      transport,
    });
    assert.equal(result.status, "DISABLED");
    assert.equal(calls.length, 0);
  });

  it("returns config error when enabled without token", async () => {
    const result = await runTanbotTelegramProbe({
      env: { TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_BOT_TOKEN: "" },
    });
    assert.equal(result.status, "CONFIG_ERROR");
  });

  it("returns local ok for valid config without live flag", async () => {
    const { transport, calls } = mockTransport({});
    const result = await runTanbotTelegramProbe({ env: VALID_ENV, transport });
    assert.equal(result.status, "LOCAL_OK");
    assert.equal(result.stage, "local");
    assert.equal(calls.length, 0);
  });

  it("live success checks username and webhook info", async () => {
    const { transport, calls } = mockTransport({
      getMe: () => ({
        ok: true,
        result: { id: 42, is_bot: true, username: "TANDOOR_IBOT" },
      }),
      getWebhookInfo: () => ({
        ok: true,
        result: {
          url: "https://example.com/telegram/webhook",
          pending_update_count: 3,
          last_error_date: 1_700_000_000,
          last_error_message: "connection timed out",
        },
      }),
    });
    const result = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.botUsernameMatches, true);
    assert.equal(result.webhookConfigured, true);
    assert.equal(result.pendingUpdateCount, 3);
    assert.ok(result.lastWebhookErrorAt);
    assert.deepEqual(calls.map((c) => c.method), ["getMe", "getWebhookInfo"]);
  });

  it("detects username mismatch", async () => {
    const { transport } = mockTransport({
      getMe: () => ({
        ok: true,
        result: { id: 42, is_bot: true, username: "OTHER_BOT" },
      }),
    });
    const result = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    assert.equal(result.status, "USERNAME_MISMATCH");
  });

  it("maps Telegram unauthorized to AUTH_FAILED", async () => {
    const { transport } = mockTransport({
      getMe: () => ({ ok: false, code: "UNAUTHORIZED", message: "Telegram rejected the bot token." }),
    });
    const result = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    assert.equal(result.status, "AUTH_FAILED");
  });

  it("maps rate limit and network failures", async () => {
    const rate = await runTanbotTelegramProbe({
      env: VALID_ENV,
      live: true,
      transport: async () => ({ ok: false, code: "RATE_LIMITED", message: "Telegram rate limit exceeded." }),
    });
    assert.equal(rate.status, "RATE_LIMITED");

    const net = await runTanbotTelegramProbe({
      env: VALID_ENV,
      live: true,
      transport: async () => ({ ok: false, code: "NETWORK_ERROR", message: "Telegram network request failed." }),
    });
    assert.equal(net.status, "NETWORK_ERROR");
  });

  it("handles empty webhook without claiming bot is free", async () => {
    const { transport } = mockTransport({
      getMe: () => ({
        ok: true,
        result: { id: 7, is_bot: true, username: "TANDOOR_IBOT" },
      }),
      getWebhookInfo: () => ({
        ok: true,
        result: { url: "", pending_update_count: 0 },
      }),
    });
    const result = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.webhookConfigured, false);
    assert.match(result.message, /proof of a free bot/i);
  });

  it("does not leak synthetic token in diagnostics output", async () => {
    const failingUrl = buildTelegramMethodUrl(SYNTH_TOKEN, "getMe");
    const { transport } = mockTransport({
      getMe: async () => ({
        ok: false,
        code: "NETWORK_ERROR",
        message: `Failed to fetch ${failingUrl}`,
      }),
    });
    const result = await runTanbotTelegramProbe({ env: VALID_ENV, live: true, transport });
    const serialized = formatDiagnosticReportForCli(result);
    assert.doesNotMatch(serialized, /SYNTH_TANBOT_TOKEN_LEAK_MARKER/);
    assert.doesNotMatch(serialized, /123456789:/);
  });

  it("allows repeated local probes without transport calls", async () => {
    const { transport, calls } = mockTransport({});
    await runTanbotTelegramProbe({ env: VALID_ENV, transport });
    await runTanbotTelegramProbe({ env: VALID_ENV, transport });
    assert.equal(calls.length, 0);
  });

  it("parses CLI args with optional live flag", () => {
    assert.deepEqual(parseTanbotTelegramProbeCliArgs([]), {
      ok: true,
      options: { live: false },
    });
    assert.deepEqual(parseTanbotTelegramProbeCliArgs(["--live"]), {
      ok: true,
      options: { live: true },
    });
    assert.equal(parseTanbotTelegramProbeCliArgs(["--unknown"]).ok, false);
  });

  it("does not embed tanbot secrets in public static bundle", () => {
    const publicDir = path.join(process.cwd(), "public");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|html|css)$/i.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes("TANBOT_TELEGRAM_BOT_TOKEN") || text.includes("tanbot-telegram")) {
            hits.push(full);
          }
        }
      }
    };
    walk(publicDir);
    assert.deepEqual(hits, []);
  });
});
