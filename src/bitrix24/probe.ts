import { isBitrix24Enabled, loadBitrix24Config } from "./config";
import { readBitrixTasksForUser } from "./read-tasks";
import { readBitrixUserById } from "./read-users";
import { sanitizeProbeResult } from "./sanitize";
import type { Bitrix24Fetch, Bitrix24ProbeResult, Bitrix24ProbeStatus } from "./types";
import type { Bitrix24TransportOptions } from "./transport";

const UNAVAILABLE_FEATURES = [
  "checklists",
  "attachments",
  "comments",
  "chats",
  "claims",
  "bitrix_writeback",
  "oauth",
  "task_cache",
  "employee_mapping_persistence",
  "client_task_binding_persistence",
] as const;

export type RunBitrix24ProbeOptions = Bitrix24TransportOptions & {
  env?: NodeJS.ProcessEnv;
  live?: boolean;
  bitrixUserId?: string;
  probeMaxPages?: number;
};

function mapTransportStatus(code: string): Bitrix24ProbeStatus {
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
    case "HOST_BLOCKED":
    case "REDIRECT_BLOCKED":
      return "NETWORK_ERROR";
    default:
      return "API_ERROR";
  }
}

export async function runBitrix24Probe(
  options: RunBitrix24ProbeOptions = {},
): Promise<Bitrix24ProbeResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const checks: string[] = [];

  if (!isBitrix24Enabled(env)) {
    return sanitizeProbeResult({
      status: "DISABLED",
      durationMs: Date.now() - startedAt,
      message: "Bitrix24 integration is disabled (BITRIX24_ENABLED=false).",
      checks: ["integration_disabled"],
      unavailableFeatures: [...UNAVAILABLE_FEATURES],
    });
  }

  const loaded = loadBitrix24Config(env);
  if (!loaded.ok) {
    return sanitizeProbeResult({
      status: "CONFIG_ERROR",
      durationMs: Date.now() - startedAt,
      message: loaded.message,
      checks: ["config_invalid"],
      unavailableFeatures: [...UNAVAILABLE_FEATURES],
    });
  }

  const config = loaded.config;
  checks.push("config_loaded");
  checks.push("portal_host_validated");
  checks.push("fixed_methods_only");

  if (!options.live) {
    return sanitizeProbeResult(
      {
        status: "LOCAL_OK",
        durationMs: Date.now() - startedAt,
        message: "Bitrix24 configuration passed local validation. Live portal scan was not requested.",
        portalId: config.portalId,
        checks: [...checks, "local_validation_only"],
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      },
      config,
    );
  }

  if (!options.bitrixUserId) {
    return sanitizeProbeResult(
      {
        status: "LIVE_REQUIRES_USER",
        durationMs: Date.now() - startedAt,
        message: "Live Bitrix24 diagnostics require --bitrix-user-id.",
        portalId: config.portalId,
        checks: [...checks, "live_requires_user"],
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      },
      config,
    );
  }

  checks.push("live_mode_requested");

  const userResult = await readBitrixUserById(config, options.bitrixUserId, {
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    startedAt,
    maxTotalDurationMs: config.maxTotalDurationMs,
  });

  if (!userResult.ok) {
    if (userResult.code === "USER_NOT_FOUND" || userResult.code === "INVALID_USER_ID") {
      return sanitizeProbeResult(
        {
          status: "INVALID_USER",
          durationMs: Date.now() - startedAt,
          message: userResult.message,
          portalId: config.portalId,
          checks: [...checks, "user_lookup_failed"],
          bitrixUserId: options.bitrixUserId,
          errorCode: userResult.code,
          unavailableFeatures: [...UNAVAILABLE_FEATURES],
        },
        config,
      );
    }

    return sanitizeProbeResult(
      {
        status: mapTransportStatus(userResult.code),
        durationMs: Date.now() - startedAt,
        message: userResult.message,
        portalId: config.portalId,
        checks: [...checks, "user_lookup_failed"],
        bitrixUserId: options.bitrixUserId,
        errorCode: userResult.code,
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      },
      config,
    );
  }

  checks.push("user_lookup_ok");

  const tasksResult = await readBitrixTasksForUser(config, options.bitrixUserId, {
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    startedAt,
    maxPages: options.probeMaxPages ?? Math.min(config.maxPages, 3),
  });

  if (!tasksResult.ok) {
    return sanitizeProbeResult(
      {
        status: mapTransportStatus(tasksResult.code),
        durationMs: Date.now() - startedAt,
        message: tasksResult.message,
        portalId: config.portalId,
        checks: [...checks, "task_list_failed"],
        bitrixUserId: options.bitrixUserId,
        usersChecked: 1,
        errorCode: tasksResult.code,
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      },
      config,
    );
  }

  checks.push("task_list_ok");
  checks.push("pagination_checked");
  checks.push("fields_checked");

  const status: Bitrix24ProbeStatus = tasksResult.data.complete ? "SUCCESS" : "PARTIAL";

  return sanitizeProbeResult(
    {
      status,
      durationMs: Date.now() - startedAt,
      message: tasksResult.data.complete
        ? "Bitrix24 live diagnostics completed with a complete limited task sample."
        : "Bitrix24 live diagnostics returned a partial task sample.",
      portalId: config.portalId,
      checks,
      bitrixUserId: options.bitrixUserId,
      usersChecked: 1,
      tasksFetched: tasksResult.data.tasks.length,
      tasksComplete: tasksResult.data.complete,
      unavailableFeatures: [...UNAVAILABLE_FEATURES],
      errorCode: tasksResult.data.truncatedReason,
    },
    config,
  );
}

export function getBitrix24ProbeExitCode(status: Bitrix24ProbeResult["status"]): number {
  return status === "SUCCESS" || status === "LOCAL_OK" || status === "DISABLED" ? 0 : 1;
}

export type { Bitrix24Fetch };
