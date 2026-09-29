export type ScheduledExchangeConfig = {
  applyEnabled: boolean;
  acceptedBaselineSha256: string | null;
  stabilityDelayMs: number;
  readRetries: number;
  staleAfterHours: number;
  readDeadlineMs: number | undefined;
};

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return defaultValue;
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return defaultValue;
  }
  return parsed;
}

function parseSha256(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") {
    return null;
  }
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

export function loadScheduledExchangeConfig(env: NodeJS.ProcessEnv = process.env): ScheduledExchangeConfig {
  const readDeadlineRaw = env.ONEC_SCHEDULED_EXCHANGE_READ_DEADLINE_MS;
  const readDeadlineMs =
    readDeadlineRaw && readDeadlineRaw.trim() !== "" ? parsePositiveInt(readDeadlineRaw, 60_000) : undefined;

  return {
    applyEnabled: parseBoolean(env.ONEC_SCHEDULED_EXCHANGE_APPLY, false),
    acceptedBaselineSha256: parseSha256(env.ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256),
    stabilityDelayMs: parsePositiveInt(env.ONEC_SCHEDULED_EXCHANGE_STABILITY_DELAY_MS, 2_000),
    readRetries: parsePositiveInt(env.ONEC_SCHEDULED_EXCHANGE_READ_RETRIES, 1),
    staleAfterHours: parsePositiveInt(env.ONEC_SCHEDULED_EXCHANGE_STALE_HOURS, 72),
    readDeadlineMs,
  };
}
