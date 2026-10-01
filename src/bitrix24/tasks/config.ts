export type Bitrix24TasksMode = "pilot" | "working";

const MAX_WORKING_TASKS_PER_SYNC = 100;
const MAX_WORKING_DISCOVERY_PAGES = 50;
const MAX_WORKING_DISCOVERY_PAGES_TOTAL = 100;

export type Bitrix24TasksRuntimeConfig = {
  tasksMode: Bitrix24TasksMode;
  cachePublishEnabled: boolean;
  cacheAccessTtlMs: number;
  linkVerificationTtlMs: number;
  pilotTaskIds: Set<string>;
  pilotAllowListRequired: boolean;
  portalPublicUrl: string | null;
  workingMaxTasksPerSync: number;
  workingMaxDiscoveryPages: number;
  workingMaxDiscoveryPagesTotal: number;
};

export function isCachePublishAllowed(config: Bitrix24TasksRuntimeConfig): boolean {
  return config.cachePublishEnabled && config.cacheAccessTtlMs > 0;
}

function parseTasksMode(raw: string | undefined): Bitrix24TasksMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "working") {
    return "working";
  }
  return "pilot";
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim() || String(fallback));
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function parseBoundedPositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  return Math.min(parsePositiveInt(raw, fallback), max);
}

/** Working mode requires explicit cache publish policy; incomplete config stays on pilot rules. */
export function isWorkingModeActive(
  config: Bitrix24TasksRuntimeConfig,
): boolean {
  return config.tasksMode === "working" && isCachePublishAllowed(config);
}

export function isPilotTaskFilterActive(config: Bitrix24TasksRuntimeConfig): boolean {
  return !isWorkingModeActive(config) && config.pilotAllowListRequired;
}

export function loadBitrix24TasksRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): Bitrix24TasksRuntimeConfig {
  const publishRaw = env.BITRIX24_CACHE_PUBLISH_ENABLED?.trim().toLowerCase();
  const cachePublishEnabled = publishRaw === "true" || publishRaw === "1";
  const ttlRaw = Number(env.BITRIX24_CACHE_ACCESS_TTL_MS?.trim() || "0");
  const cacheAccessTtlMs =
    Number.isInteger(ttlRaw) && ttlRaw > 0 ? ttlRaw : 0;
  const verificationRaw = Number(env.BITRIX24_LINK_VERIFICATION_TTL_MS?.trim() || "0");
  const linkVerificationTtlMs =
    Number.isInteger(verificationRaw) && verificationRaw > 0
      ? verificationRaw
      : cacheAccessTtlMs;
  const pilotTaskIds = new Set(
    (env.BITRIX24_PILOT_TASK_IDS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const portalPublicUrl = env.BITRIX24_PORTAL_PUBLIC_URL?.trim() || null;
  const pilotRequiredRaw = env.BITRIX24_PILOT_ALLOWLIST_REQUIRED?.trim().toLowerCase();
  const pilotAllowListRequired =
    pilotRequiredRaw === undefined || pilotRequiredRaw === ""
      ? true
      : pilotRequiredRaw === "true" || pilotRequiredRaw === "1";
  return {
    tasksMode: parseTasksMode(env.BITRIX24_TASKS_MODE),
    cachePublishEnabled,
    cacheAccessTtlMs,
    linkVerificationTtlMs,
    pilotTaskIds,
    pilotAllowListRequired,
    portalPublicUrl,
    workingMaxTasksPerSync: parseBoundedPositiveInt(
      env.BITRIX24_WORKING_MAX_TASKS_PER_SYNC,
      20,
      MAX_WORKING_TASKS_PER_SYNC,
    ),
    workingMaxDiscoveryPages: parseBoundedPositiveInt(
      env.BITRIX24_WORKING_MAX_DISCOVERY_PAGES,
      5,
      MAX_WORKING_DISCOVERY_PAGES,
    ),
    workingMaxDiscoveryPagesTotal: parseBoundedPositiveInt(
      env.BITRIX24_WORKING_MAX_DISCOVERY_PAGES_TOTAL,
      25,
      MAX_WORKING_DISCOVERY_PAGES_TOTAL,
    ),
  };
}
