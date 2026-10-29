import { extractDatabaseName } from "./test-database-guard";

/** Dedicated PostgreSQL database for isolated tt56 user testing only. */
export const TT56_USER_TEST_DATABASE_NAME = "tandoor_rf_tt56_user_test";

/** Extra synthetic DB names allowed for seed/QA only (must still match test-database-guard *_test). */
export const TT56_USER_TEST_SEED_EXTRA_DATABASE_NAMES = ["tandoor_rf_tt56_legacy_fresh_test"] as const;

export const TT56_USER_TEST_BANNER =
  "ТЕСТОВАЯ СРЕДА. Не использовать для реальных передач.";

export function isTanTrackerUserTestSeedDatabaseName(dbName: string): boolean {
  if (dbName === TT56_USER_TEST_DATABASE_NAME) return true;
  return (TT56_USER_TEST_SEED_EXTRA_DATABASE_NAMES as readonly string[]).includes(dbName);
}

export function assertTanTrackerUserTestDatabaseUrl(
  url: string,
  context = "tan-tracker user test",
): void {
  const dbName = extractDatabaseName(url);
  if (dbName !== TT56_USER_TEST_DATABASE_NAME) {
    throw new Error(
      `Refusing ${context} on database "${dbName}". Expected only ${TT56_USER_TEST_DATABASE_NAME}.`,
    );
  }
}

export function assertTanTrackerUserTestSeedDatabaseUrl(
  url: string,
  context = "tan-tracker user test seed",
): void {
  const dbName = extractDatabaseName(url);
  if (!isTanTrackerUserTestSeedDatabaseName(dbName)) {
    throw new Error(
      `Refusing ${context} on database "${dbName}". Expected ${TT56_USER_TEST_DATABASE_NAME} or an approved tt56 QA seed database.`,
    );
  }
}

export function tanTrackerUserTestBannerForApi(
  env: NodeJS.ProcessEnv = process.env,
): { userTestEnvironmentBanner: string | null } {
  return {
    userTestEnvironmentBanner: isTanTrackerUserTestEnv(env) ? TT56_USER_TEST_BANNER : null,
  };
}

/** True when operator explicitly enabled tt56 user-test mode (may still be misconfigured). */
export function isTanTrackerUserTestEnvRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TT_USER_TEST_ENV?.trim().toLowerCase() === "true";
}

export function isTanTrackerUserTestEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TT_USER_TEST_ENV?.trim().toLowerCase() !== "true") {
    return false;
  }
  if (env.NODE_ENV === "production") {
    return false;
  }
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    return false;
  }
  try {
    assertTanTrackerUserTestDatabaseUrl(url, "TT_USER_TEST_ENV");
    return true;
  } catch {
    return false;
  }
}
