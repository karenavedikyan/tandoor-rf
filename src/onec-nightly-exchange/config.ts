export type NightlyExchangeEnabledConfig = {
  scheduleTime: string;
  timezone: "Europe/Moscow";
  windowMinutes: number;
};

export type NightlyExchangeConfigLoadResult =
  | { ok: true; enabled: false }
  | { ok: true; enabled: true; config: NightlyExchangeEnabledConfig }
  | { ok: false; error: string };

/** @deprecated Tests may inject config directly into scheduler; production uses loadNightlyExchangeConfig. */
export type NightlyExchangeConfig = NightlyExchangeEnabledConfig & {
  enabled: boolean;
};

const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_WINDOW_MINUTES = 1;
const MAX_WINDOW_MINUTES = 180;

function parseBoolean(value: string | undefined): boolean | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}

function parseRequiredScheduleTime(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  if (!SCHEDULE_TIME_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function parseRequiredWindowMinutes(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_WINDOW_MINUTES || parsed > MAX_WINDOW_MINUTES) {
    return null;
  }
  return parsed;
}

/** Strict loader: disabled by default; when enabled, time and window are required and valid (no fallbacks). */
export function loadNightlyExchangeConfig(
  env: NodeJS.ProcessEnv = process.env,
): NightlyExchangeConfigLoadResult {
  const enabledFlag = parseBoolean(env.ONEC_NIGHTLY_EXCHANGE_ENABLED);
  const enabled = enabledFlag === true;

  if (!enabled) {
    return { ok: true, enabled: false };
  }

  const scheduleTime = parseRequiredScheduleTime(env.ONEC_NIGHTLY_EXCHANGE_TIME);
  if (!env.ONEC_NIGHTLY_EXCHANGE_TIME?.trim()) {
    return {
      ok: false,
      error: "ONEC_NIGHTLY_EXCHANGE_TIME is required when ONEC_NIGHTLY_EXCHANGE_ENABLED=true.",
    };
  }
  if (!scheduleTime) {
    return {
      ok: false,
      error: `Invalid ONEC_NIGHTLY_EXCHANGE_TIME: ${env.ONEC_NIGHTLY_EXCHANGE_TIME.trim()}`,
    };
  }

  const windowRaw = env.ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES?.trim();
  if (!windowRaw) {
    return {
      ok: false,
      error:
        "ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES is required when ONEC_NIGHTLY_EXCHANGE_ENABLED=true.",
    };
  }
  const windowMinutes = parseRequiredWindowMinutes(env.ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES);
  if (windowMinutes == null) {
    return {
      ok: false,
      error: `Invalid ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: ${windowRaw}`,
    };
  }

  return {
    ok: true,
    enabled: true,
    config: {
      scheduleTime,
      timezone: "Europe/Moscow",
      windowMinutes,
    },
  };
}

export function isNightlyExchangeScheduleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const loaded = loadNightlyExchangeConfig(env);
  return loaded.ok && loaded.enabled;
}
