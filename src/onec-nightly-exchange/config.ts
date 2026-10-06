export type NightlyExchangeConfig = {
  enabled: boolean;
  /** HH:MM wall-clock time in Europe/Moscow; not a production default until agreed with ops. */
  scheduleTime: string;
  timezone: "Europe/Moscow";
  /** Minutes after scheduleTime during which at most one nightly job may be enqueued. */
  windowMinutes: number;
};

const DEFAULT_SCHEDULE_TIME = "02:30";
const DEFAULT_WINDOW_MINUTES = 60;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parseScheduleTime(value: string | undefined): string {
  const raw = (value ?? DEFAULT_SCHEDULE_TIME).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    return DEFAULT_SCHEDULE_TIME;
  }
  return raw;
}

function parseWindowMinutes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 180) {
    return DEFAULT_WINDOW_MINUTES;
  }
  return parsed;
}

export function loadNightlyExchangeConfig(env: NodeJS.ProcessEnv = process.env): NightlyExchangeConfig {
  return {
    enabled: parseBoolean(env.ONEC_NIGHTLY_EXCHANGE_ENABLED, false),
    scheduleTime: parseScheduleTime(env.ONEC_NIGHTLY_EXCHANGE_TIME),
    timezone: "Europe/Moscow",
    windowMinutes: parseWindowMinutes(env.ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES),
  };
}
