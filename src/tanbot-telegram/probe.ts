import { telegramGetMe, telegramGetWebhookInfo, usernamesMatch } from "./adapter";
import {
  DEFAULT_EXPECTED_BOT_USERNAME,
  describeTanbotTelegramConfigPresence,
  isTanbotTelegramEnabled,
  loadTanbotTelegramConfig,
} from "./config";
import {
  GENERIC_WEBHOOK_ERROR_MESSAGE,
  publicExpectedUsername,
  sanitizeDiagnosticReport,
} from "./sanitize";
import { createDefaultTelegramTransport } from "./transport";
import type {
  TanbotTelegramDiagnosticReport,
  TanbotTelegramProbeStatus,
  TelegramTransportCall,
} from "./types";

export type RunTanbotTelegramProbeOptions = {
  env?: NodeJS.ProcessEnv;
  live?: boolean;
  transport?: TelegramTransportCall;
  now?: () => Date;
};

function formatCheckedAt(now: Date): string {
  return now.toISOString();
}

function mapTransportCode(code: string): TanbotTelegramProbeStatus {
  switch (code) {
    case "UNAUTHORIZED":
      return "AUTH_FAILED";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "NETWORK_ERROR":
      return "NETWORK_ERROR";
    default:
      return "API_ERROR";
  }
}

function recommendationFor(status: TanbotTelegramProbeStatus, live: boolean): string {
  switch (status) {
    case "DISABLED":
      return "Leave integration disabled until the owner approves provision of TANBOT_TELEGRAM_BOT_TOKEN on the server.";
    case "CONFIG_ERROR":
      return "Fix server environment variables, then rerun local diagnostics before any live check.";
    case "LOCAL_OK":
      return live
        ? "Configuration is valid locally. Live checks were not requested in this run."
        : "Configuration is valid locally. Run diagnostics with --live only after the token is provisioned on the server.";
    case "AUTH_FAILED":
      return "Verify the bot token in server secrets matches @TANDOOR_IBOT in BotFather. Do not paste the token into chat or commits.";
    case "USERNAME_MISMATCH":
      return "Token belongs to a different bot username. Confirm the correct @TANDOOR_IBOT token before any webhook work.";
    case "SUCCESS":
      return "Read-only checks passed. Do not set or change webhook until a separate approved stage. Empty webhook URL does not prove the bot is unused elsewhere.";
    case "RATE_LIMITED":
      return "Wait and retry live diagnostics later; avoid repeated live probes.";
    default:
      return "Review sanitized diagnostics output and retry after network or Telegram API conditions improve.";
  }
}

export function getTanbotTelegramProbeExitCode(status: TanbotTelegramProbeStatus): number {
  if (status === "DISABLED" || status === "LOCAL_OK" || status === "SUCCESS") return 0;
  if (status === "CONFIG_ERROR") return 2;
  return 1;
}

export async function runTanbotTelegramProbe(
  options: RunTanbotTelegramProbeOptions = {},
): Promise<TanbotTelegramDiagnosticReport> {
  const startedAtMs = Date.now();
  const env = options.env ?? process.env;
  const checkedAt = formatCheckedAt(options.now?.() ?? new Date());
  const presence = describeTanbotTelegramConfigPresence(env);
  const expectedUsernameLabel = publicExpectedUsername(DEFAULT_EXPECTED_BOT_USERNAME);
  const checks: string[] = [];

  if (!isTanbotTelegramEnabled(env)) {
    return sanitizeDiagnosticReport({
      status: "DISABLED",
      configured: presence.tokenPresent,
      enabled: false,
      stage: "local",
      expectedUsername: expectedUsernameLabel,
      botUsernameMatches: null,
      verifiedBotId: null,
      verifiedBotUsername: null,
      webhookConfigured: null,
      pendingUpdateCount: null,
      lastWebhookErrorAt: null,
      lastWebhookErrorMessage: null,
      message: "Tanbot Telegram integration is disabled (TANBOT_TELEGRAM_ENABLED=false).",
      recommendation: recommendationFor("DISABLED", false),
      checks: ["integration_disabled"],
      checkedAt,
      durationMs: Date.now() - startedAtMs,
    });
  }

  const loaded = loadTanbotTelegramConfig(env);
  if (!loaded.ok) {
    return sanitizeDiagnosticReport({
      status: "CONFIG_ERROR",
      configured: presence.tokenPresent,
      enabled: true,
      stage: "local",
      expectedUsername: expectedUsernameLabel,
      botUsernameMatches: null,
      verifiedBotId: null,
      verifiedBotUsername: null,
      webhookConfigured: null,
      pendingUpdateCount: null,
      lastWebhookErrorAt: null,
      lastWebhookErrorMessage: null,
      message: loaded.message,
      recommendation: recommendationFor("CONFIG_ERROR", false),
      checks: ["config_invalid"],
      checkedAt,
      durationMs: Date.now() - startedAtMs,
    });
  }

  const config = loaded.config;
  checks.push("config_loaded");
  checks.push("read_only_methods_only");

  if (!options.live) {
    return sanitizeDiagnosticReport(
      {
        status: "LOCAL_OK",
        configured: true,
        enabled: true,
        stage: "local",
        expectedUsername: publicExpectedUsername(config.expectedUsername),
        botUsernameMatches: null,
        verifiedBotId: null,
        verifiedBotUsername: null,
        webhookConfigured: null,
        pendingUpdateCount: null,
        lastWebhookErrorAt: null,
        lastWebhookErrorMessage: null,
        message:
          "Tanbot Telegram configuration passed local validation. Live Telegram API checks were not requested.",
        recommendation: recommendationFor("LOCAL_OK", false),
        checks: [...checks, "local_validation_only"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
      },
      config,
    );
  }

  const transport = options.transport ?? createDefaultTelegramTransport();
  checks.push("live_requested");

  const getMe = await telegramGetMe(config, transport);
  if (!getMe.ok) {
    const status = mapTransportCode(getMe.code);
    return sanitizeDiagnosticReport(
      {
        status,
        configured: true,
        enabled: true,
        stage: "live_get_me",
        expectedUsername: publicExpectedUsername(config.expectedUsername),
        botUsernameMatches: null,
        verifiedBotId: null,
        verifiedBotUsername: null,
        webhookConfigured: null,
        pendingUpdateCount: null,
        lastWebhookErrorAt: null,
        lastWebhookErrorMessage: null,
        message: getMe.message,
        recommendation: recommendationFor(status, true),
        checks: [...checks, "live_get_me_failed"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
      },
      config,
    );
  }

  checks.push("live_get_me_ok");
  const verifiedBotUsername = getMe.me.username ?? null;
  const usernameMatches = usernamesMatch(config.expectedUsername, verifiedBotUsername ?? undefined);
  if (!usernameMatches) {
    return sanitizeDiagnosticReport(
      {
        status: "USERNAME_MISMATCH",
        configured: true,
        enabled: true,
        stage: "live_get_me",
        expectedUsername: publicExpectedUsername(config.expectedUsername),
        botUsernameMatches: false,
        verifiedBotId: getMe.me.id,
        verifiedBotUsername,
        webhookConfigured: null,
        pendingUpdateCount: null,
        lastWebhookErrorAt: null,
        lastWebhookErrorMessage: null,
        message: "Telegram bot username does not match the expected @TANDOOR_IBOT.",
        recommendation: recommendationFor("USERNAME_MISMATCH", true),
        checks: [...checks, "username_mismatch"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
      },
      config,
    );
  }

  checks.push("username_matches");

  const webhook = await telegramGetWebhookInfo(config, transport);
  if (!webhook.ok) {
    const status = mapTransportCode(webhook.code);
    return sanitizeDiagnosticReport(
      {
        status,
        configured: true,
        enabled: true,
        stage: "live_webhook_info",
        expectedUsername: publicExpectedUsername(config.expectedUsername),
        botUsernameMatches: true,
        verifiedBotId: getMe.me.id,
        verifiedBotUsername,
        webhookConfigured: null,
        pendingUpdateCount: null,
        lastWebhookErrorAt: null,
        lastWebhookErrorMessage: null,
        message: webhook.message,
        recommendation: recommendationFor(status, true),
        checks: [...checks, "live_webhook_info_failed"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
      },
      config,
    );
  }

  checks.push("live_webhook_info_ok");
  const info = webhook.info;
  const webhookUrl = info.url;

  return sanitizeDiagnosticReport(
    {
      status: "SUCCESS",
      configured: true,
      enabled: true,
      stage: "complete",
      expectedUsername: publicExpectedUsername(config.expectedUsername),
      botUsernameMatches: true,
      verifiedBotId: getMe.me.id,
      verifiedBotUsername,
      webhookConfigured: webhookUrl.length > 0,
      pendingUpdateCount: info.pendingUpdateCount,
      lastWebhookErrorAt: info.lastErrorAt,
      lastWebhookErrorMessage: info.lastErrorReported ? GENERIC_WEBHOOK_ERROR_MESSAGE : null,
      message:
        webhookUrl.length > 0
          ? "Live read-only Telegram checks succeeded. A webhook URL is currently set."
          : "Live read-only Telegram checks succeeded. Telegram reports no webhook URL; this can also occur with polling elsewhere—do not treat it as proof of a free bot.",
      recommendation: recommendationFor("SUCCESS", true),
      checks: [...checks, "live_read_only_complete"],
      checkedAt,
      durationMs: Date.now() - startedAtMs,
    },
    config,
  );
}
