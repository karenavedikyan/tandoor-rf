import {
  assertTanTrackerUserTestDatabaseUrl,
  isTanTrackerUserTestEnv,
  isTanTrackerUserTestEnvRequested,
} from "./tan-tracker-user-test-env";

/** Env keys that must stay off/disabled on the tt56 user-test stand (fail-closed). */
export const TT56_USER_TEST_FORBIDDEN_ENABLED_FLAGS = [
  "ONEC_NIGHTLY_EXCHANGE_ENABLED",
  "ONEC_FTP_ENABLED",
  "BITRIX24_ENABLED",
  "TANBOT_TELEGRAM_ENABLED",
  "TANBOT_TELEGRAM_WEBHOOK_ENABLED",
  "TANBOT_TELEGRAM_DELIVERY_ENABLED",
] as const;

export const TT56_USER_TEST_DEFAULTS: Record<string, string> = {
  ONEC_NIGHTLY_EXCHANGE_ENABLED: "false",
  ONEC_FTP_ENABLED: "false",
  BITRIX24_ENABLED: "false",
  TANBOT_TELEGRAM_ENABLED: "false",
  TANBOT_TELEGRAM_WEBHOOK_ENABLED: "false",
  TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
  TT_PHONE_VERIFICATION_PROVIDER: "test",
};

function isTruthyEnv(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function assertForbiddenIntegrationFlagsOff(env: NodeJS.ProcessEnv): void {
  for (const key of TT56_USER_TEST_FORBIDDEN_ENABLED_FLAGS) {
    if (isTruthyEnv(env[key])) {
      throw new Error(
        `Refusing tt56 user-test start: ${key}=true is not allowed on the isolated test stand.`,
      );
    }
  }
}

/** Apply safe defaults when test mode is requested (before validating full config). */
export function applyTanTrackerUserTestRuntimeDefaults(env: NodeJS.ProcessEnv = process.env): void {
  if (!isTanTrackerUserTestEnvRequested(env)) return;
  for (const [key, value] of Object.entries(TT56_USER_TEST_DEFAULTS)) {
    if (env[key] === undefined || env[key] === "") {
      env[key] = value;
    }
  }
}

/**
 * Fail-closed startup when TT_USER_TEST_ENV=true: reject misconfiguration before HTTP/background work.
 * No-op when test mode is not requested (production/default paths unchanged).
 */
export function assertTanTrackerUserTestStartup(env: NodeJS.ProcessEnv = process.env): void {
  if (!isTanTrackerUserTestEnvRequested(env)) return;

  if (env.NODE_ENV === "production") {
    throw new Error("Refusing tt56 user-test startup: NODE_ENV=production with TT_USER_TEST_ENV=true.");
  }

  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Refusing tt56 user-test startup: DATABASE_URL is required when TT_USER_TEST_ENV=true.");
  }

  assertTanTrackerUserTestDatabaseUrl(url, "startup");
  applyTanTrackerUserTestRuntimeDefaults(env);
  assertForbiddenIntegrationFlagsOff(env);
}

/** @deprecated Use assertTanTrackerUserTestStartup */
export function assertTanTrackerUserTestRuntimeIsolation(env: NodeJS.ProcessEnv = process.env): void {
  if (!isTanTrackerUserTestEnvRequested(env)) return;
  applyTanTrackerUserTestRuntimeDefaults(env);
  assertForbiddenIntegrationFlagsOff(env);
}

export function shouldSkipBackgroundIntegrations(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTanTrackerUserTestEnv(env);
}
