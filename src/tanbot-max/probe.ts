import { maxGetMe, maxGetSubscriptions, usernamesMatch } from "./adapter";
import {
  DEFAULT_EXPECTED_BOT_USERNAME,
  describeTanbotMaxConfigPresence,
  isTanbotMaxEnabled,
  loadTanbotMaxConfig,
} from "./config";
import { CREDENTIAL_PROXY_BOUNDARY_NOTE, publicExpectedUsername, sanitizeDiagnosticReport } from "./sanitize";
import { createDefaultMaxTransport, maxTlsReachabilityProbe } from "./transport";
import type { MaxTransportCall, TanbotMaxDiagnosticReport, TanbotMaxProbeStatus } from "./types";

export type RunTanbotMaxProbeOptions = {
  env?: NodeJS.ProcessEnv;
  live?: boolean;
  tlsProbe?: boolean;
  transport?: MaxTransportCall;
  now?: () => Date;
};

function mapTransportCode(code: string): TanbotMaxProbeStatus {
  switch (code) {
    case "UNAUTHORIZED":
      return "AUTH_FAILED";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "TLS_ERROR":
      return "TLS_ERROR";
    case "NETWORK_ERROR":
      return "NETWORK_ERROR";
    default:
      return "API_ERROR";
  }
}

function recommendationFor(status: TanbotMaxProbeStatus): string {
  switch (status) {
    case "DISABLED":
      return "Leave MAX integration disabled until the owner approves TANBOT_MAX_BOT_TOKEN on the server.";
    case "CONFIG_ERROR":
      return "Fix server environment variables, then rerun local diagnostics.";
    case "LOCAL_OK":
      return "Configuration passed local validation. Use --live only after token is provisioned on the server.";
    case "TLS_PROBE_OK":
      return "TLS reachability to platform-api2.max.ru succeeded (401 without token). This is not token validation.";
    case "AUTH_FAILED":
      return "Verify the bot token in server secrets. Do not paste the token into chat or commits.";
    case "USERNAME_MISMATCH":
      return "Token belongs to a different bot username than TANBOT_MAX_EXPECTED_USERNAME.";
    case "SUCCESS":
      return "Read-only checks passed. Do not register webhooks until a separate approved stage.";
    default:
      return "Review sanitized diagnostics and retry after network or MAX API conditions improve.";
  }
}

export function getTanbotMaxProbeExitCode(status: TanbotMaxProbeStatus): number {
  if (status === "DISABLED" || status === "LOCAL_OK" || status === "SUCCESS" || status === "TLS_PROBE_OK") {
    return 0;
  }
  if (status === "CONFIG_ERROR") return 2;
  return 1;
}

export async function runTanbotMaxProbe(
  options: RunTanbotMaxProbeOptions = {},
): Promise<TanbotMaxDiagnosticReport> {
  const startedAtMs = Date.now();
  const env = options.env ?? process.env;
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const presence = describeTanbotMaxConfigPresence(env);
  const expectedUsernameLabel = publicExpectedUsername(DEFAULT_EXPECTED_BOT_USERNAME);
  const checks: string[] = [];
  const proxyNote = CREDENTIAL_PROXY_BOUNDARY_NOTE;

  const baseReport = (partial: Omit<TanbotMaxDiagnosticReport, "credentialProxyNote" | "tlsCaBundleConfigured">) =>
    sanitizeDiagnosticReport(
      {
        ...partial,
        tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
        credentialProxyNote: proxyNote,
      },
      undefined,
    );

  if (!isTanbotMaxEnabled(env)) {
    return baseReport({
      status: "DISABLED",
      configured: presence.tokenPresent,
      enabled: false,
      stage: "local",
      expectedUsername: expectedUsernameLabel,
      botUsernameMatches: null,
      verifiedBotUserId: null,
      verifiedBotUsername: null,
      webhookConfigured: null,
      subscriptionCount: null,
      message: "Tanbot MAX integration is disabled (TANBOT_MAX_ENABLED=false).",
      recommendation: recommendationFor("DISABLED"),
      checks: ["integration_disabled"],
      checkedAt,
      durationMs: Date.now() - startedAtMs,
    });
  }

  const loaded = loadTanbotMaxConfig(env);
  if (!loaded.ok) {
    return baseReport({
      status: "CONFIG_ERROR",
      configured: presence.tokenPresent,
      enabled: true,
      stage: "local",
      expectedUsername: expectedUsernameLabel,
      botUsernameMatches: null,
      verifiedBotUserId: null,
      verifiedBotUsername: null,
      webhookConfigured: null,
      subscriptionCount: null,
      message: loaded.message,
      recommendation: recommendationFor("CONFIG_ERROR"),
      checks: ["config_invalid"],
      checkedAt,
      durationMs: Date.now() - startedAtMs,
    });
  }

  const config = loaded.config;
  checks.push("config_loaded", "read_only_methods_only");

  const transport = options.transport ?? createDefaultMaxTransport(fetch, env);

  if (options.tlsProbe) {
    checks.push("tls_probe_requested");
    const tls = await maxTlsReachabilityProbe(transport, {
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    });
    if (!tls.ok && tls.code === "UNAUTHORIZED") {
      return sanitizeDiagnosticReport(
        {
          status: "TLS_PROBE_OK",
          configured: presence.tokenPresent,
          enabled: true,
          stage: "tls_probe",
          expectedUsername: publicExpectedUsername(config.expectedUsername),
          botUsernameMatches: null,
          verifiedBotUserId: null,
          verifiedBotUsername: null,
          webhookConfigured: null,
          subscriptionCount: null,
          message: "MAX API reachable with TLS validation; unauthenticated GET /me returned 401 as expected.",
          recommendation: recommendationFor("TLS_PROBE_OK"),
          checks: [...checks, "tls_probe_unauthorized_ok"],
          checkedAt,
          durationMs: Date.now() - startedAtMs,
          tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
          credentialProxyNote: proxyNote,
        },
        config,
      );
    }
    const status = tls.ok ? "API_ERROR" : mapTransportCode(tls.code);
    return sanitizeDiagnosticReport(
      {
        status,
        configured: true,
        enabled: true,
        stage: "tls_probe",
        expectedUsername: publicExpectedUsername(config.expectedUsername),
        botUsernameMatches: null,
        verifiedBotUserId: null,
        verifiedBotUsername: null,
        webhookConfigured: null,
        subscriptionCount: null,
        message: tls.ok ? "Unexpected success for unauthenticated GET /me." : tls.message,
        recommendation: recommendationFor(status),
        checks: [...checks, "tls_probe_failed"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
        tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
        credentialProxyNote: proxyNote,
      },
      config,
    );
  }

  if (!options.live) {
    return sanitizeDiagnosticReport(
      {
        status: "LOCAL_OK",
        configured: true,
        enabled: true,
        stage: "local",
        expectedUsername: publicExpectedUsername(config.expectedUsername),
        botUsernameMatches: null,
        verifiedBotUserId: null,
        verifiedBotUsername: null,
        webhookConfigured: null,
        subscriptionCount: null,
        message: "Tanbot MAX configuration passed local validation. Live MAX API checks were not requested.",
        recommendation: recommendationFor("LOCAL_OK"),
        checks: [...checks, "local_validation_only"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
        tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
        credentialProxyNote: proxyNote,
      },
      config,
    );
  }

  checks.push("live_requested");
  const getMe = await maxGetMe(config, transport);
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
        verifiedBotUserId: null,
        verifiedBotUsername: null,
        webhookConfigured: null,
        subscriptionCount: null,
        message: getMe.message,
        recommendation: recommendationFor(status),
        checks: [...checks, "live_get_me_failed"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
        tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
        credentialProxyNote: proxyNote,
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
        verifiedBotUserId: getMe.me.user_id,
        verifiedBotUsername,
        webhookConfigured: null,
        subscriptionCount: null,
        message: "MAX bot username does not match the expected nickname.",
        recommendation: recommendationFor("USERNAME_MISMATCH"),
        checks: [...checks, "username_mismatch"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
        tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
        credentialProxyNote: proxyNote,
      },
      config,
    );
  }

  checks.push("username_matches");
  const subs = await maxGetSubscriptions(config, transport);
  if (!subs.ok) {
    const status = mapTransportCode(subs.code);
    return sanitizeDiagnosticReport(
      {
        status,
        configured: true,
        enabled: true,
        stage: "live_subscriptions",
        expectedUsername: publicExpectedUsername(config.expectedUsername),
        botUsernameMatches: true,
        verifiedBotUserId: getMe.me.user_id,
        verifiedBotUsername,
        webhookConfigured: null,
        subscriptionCount: null,
        message: subs.message,
        recommendation: recommendationFor(status),
        checks: [...checks, "live_subscriptions_failed"],
        checkedAt,
        durationMs: Date.now() - startedAtMs,
        tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
        credentialProxyNote: proxyNote,
      },
      config,
    );
  }

  checks.push("live_subscriptions_ok");
  const count = subs.info.subscriptions.length;
  const webhookConfigured = subs.info.subscriptions.some((s) => s.url.length > 0);

  return sanitizeDiagnosticReport(
    {
      status: "SUCCESS",
      configured: true,
      enabled: true,
      stage: "complete",
      expectedUsername: publicExpectedUsername(config.expectedUsername),
      botUsernameMatches: true,
      verifiedBotUserId: getMe.me.user_id,
      verifiedBotUsername,
      webhookConfigured,
      subscriptionCount: count,
      message: webhookConfigured
        ? "Live read-only MAX checks succeeded. A webhook subscription URL is currently set."
        : "Live read-only MAX checks succeeded. No webhook subscriptions reported.",
      recommendation: recommendationFor("SUCCESS"),
      checks: [...checks, "live_read_only_complete"],
      checkedAt,
      durationMs: Date.now() - startedAtMs,
      tlsCaBundleConfigured: presence.tlsCaBundleConfigured,
      credentialProxyNote: proxyNote,
    },
    config,
  );
}
