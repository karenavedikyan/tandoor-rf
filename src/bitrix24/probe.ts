import { isBitrix24Enabled, loadBitrix24Config } from "./config";
import { readBitrixTasksForUser } from "./read-tasks";
import { readBitrixUserById } from "./read-users";
import { SAFE_READ_MESSAGES } from "./safe-errors";
import { sanitizeProbeResult } from "./sanitize";
import { createOperationContext } from "./transport";
import type { Bitrix24ProbeResult, Bitrix24ProbeStatus } from "./types";
import type { PinnedRequestFn } from "./pinned-request";
import type { ResolvePortalAddressesFn } from "./dns-resolve";

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

export type RunBitrix24ProbeOptions = {
  env?: NodeJS.ProcessEnv;
  live?: boolean;
  bitrixUserId?: string;
  probeMaxPages?: number;
  pinnedRequest?: PinnedRequestFn;
  resolvePortalAddresses?: ResolvePortalAddressesFn;
  now?: () => Date;
};

function formatCheckedAt(now: Date): string {
  return now.toISOString();
}

function mapTransportStatus(code: string): Bitrix24ProbeStatus {
  switch (code) {
    case "UNAUTHORIZED":
      return "AUTH_FAILED";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
    case "TOTAL_DURATION_EXCEEDED":
      return "TIMEOUT";
    case "NETWORK_ERROR":
    case "HOST_BLOCKED":
    case "REDIRECT_BLOCKED":
      return "NETWORK_ERROR";
    default:
      return "API_ERROR";
  }
}

function mapReadMessage(code: string): string {
  if (code in SAFE_READ_MESSAGES) {
    return SAFE_READ_MESSAGES[code as keyof typeof SAFE_READ_MESSAGES];
  }
  return "Bitrix24 diagnostics failed.";
}

export async function runBitrix24Probe(
  options: RunBitrix24ProbeOptions = {},
): Promise<Bitrix24ProbeResult> {
  const startedAtMs = Date.now();
  const checkedAt = formatCheckedAt(options.now?.() ?? new Date());
  const env = options.env ?? process.env;
  const checks: string[] = [];

  if (!isBitrix24Enabled(env)) {
    return sanitizeProbeResult({
      status: "DISABLED",
      durationMs: Date.now() - startedAtMs,
      checkedAt,
      message: "Bitrix24 integration is disabled (BITRIX24_ENABLED=false).",
      checks: ["integration_disabled"],
      unavailableFeatures: [...UNAVAILABLE_FEATURES],
    });
  }

  const loaded = loadBitrix24Config(env);
  if (!loaded.ok) {
    return sanitizeProbeResult({
      status: "CONFIG_ERROR",
      durationMs: Date.now() - startedAtMs,
      checkedAt,
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
        durationMs: Date.now() - startedAtMs,
        checkedAt,
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
        durationMs: Date.now() - startedAtMs,
        checkedAt,
        message: "Live Bitrix24 diagnostics require --bitrix-user-id.",
        portalId: config.portalId,
        checks: [...checks, "live_requires_user"],
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      },
      config,
    );
  }

  checks.push("live_mode_requested");

  const operation = createOperationContext(config, startedAtMs);
  operation.pinnedRequest = options.pinnedRequest;
  operation.resolvePortalAddresses = options.resolvePortalAddresses;

  const userResult = await readBitrixUserById(config, options.bitrixUserId, {
    operation,
    startedAtMs,
  });

  if (!userResult.ok) {
    const status =
      userResult.code === "USER_NOT_FOUND" || userResult.code === "INVALID_USER_ID"
        ? "INVALID_USER"
        : mapTransportStatus(userResult.code);
    return sanitizeProbeResult(
      {
        status,
        durationMs: Date.now() - startedAtMs,
        checkedAt,
        message: mapReadMessage(userResult.code),
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
    operation,
    startedAtMs,
    maxPages: options.probeMaxPages ?? Math.min(config.maxPages, 3),
  });

  if (!tasksResult.ok) {
    return sanitizeProbeResult(
      {
        status: mapTransportStatus(tasksResult.code),
        durationMs: Date.now() - startedAtMs,
        checkedAt,
        message: mapReadMessage(tasksResult.code),
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
  if (tasksResult.data.paginationObserved || tasksResult.data.pagesFetched > 1) {
    checks.push("pagination_checked");
  }
  if (tasksResult.data.fieldsValidatedOnSample) {
    checks.push("fields_checked");
  }

  const status: Bitrix24ProbeStatus =
    tasksResult.data.complete && tasksResult.data.rejectedTaskCount === 0
      ? "SUCCESS"
      : "PARTIAL";

  return sanitizeProbeResult(
    {
      status,
      durationMs: Date.now() - startedAtMs,
      checkedAt,
      message: tasksResult.data.complete
        ? "Bitrix24 live diagnostics completed with a complete limited task sample."
        : "Bitrix24 live diagnostics returned a partial task sample.",
      portalId: config.portalId,
      checks,
      bitrixUserId: options.bitrixUserId,
      usersChecked: 1,
      tasksFetched: tasksResult.data.tasks.length,
      tasksComplete: tasksResult.data.complete,
      rejectedTaskCount: tasksResult.data.rejectedTaskCount,
      unavailableFeatures: [...UNAVAILABLE_FEATURES],
      errorCode: tasksResult.data.truncatedReason,
    },
    config,
  );
}

export function getBitrix24ProbeExitCode(status: Bitrix24ProbeResult["status"]): number {
  return status === "SUCCESS" || status === "LOCAL_OK" || status === "DISABLED" ? 0 : 1;
}
