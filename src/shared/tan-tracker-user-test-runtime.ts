import { isTanTrackerUserTestEnv } from "./tan-tracker-user-test-env";

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

/** Apply safe defaults without weakening production (only when user-test env is active). */
export function applyTanTrackerUserTestRuntimeDefaults(env: NodeJS.ProcessEnv = process.env): void {
  if (!isTanTrackerUserTestEnv(env)) return;
  for (const [key, value] of Object.entries(TT56_USER_TEST_DEFAULTS)) {
    if (env[key] === undefined || env[key] === "") {
      env[key] = value;
    }
  }
}

export function assertTanTrackerUserTestRuntimeIsolation(env: NodeJS.ProcessEnv = process.env): void {
  if (!isTanTrackerUserTestEnv(env)) return;
  for (const key of TT56_USER_TEST_FORBIDDEN_ENABLED_FLAGS) {
    if (isTruthyEnv(env[key])) {
      throw new Error(
        `Refusing tt56 user-test start: ${key}=true is not allowed on the isolated test stand.`,
      );
    }
  }
}

export function shouldSkipBackgroundIntegrations(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTanTrackerUserTestEnv(env);
}
