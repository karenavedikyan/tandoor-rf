import { extractDatabaseName } from "./test-database-guard";

/** Dedicated PostgreSQL database for isolated tt56 user testing only. */
export const TT56_USER_TEST_DATABASE_NAME = "tandoor_rf_tt56_user_test";

export const TT56_USER_TEST_BANNER =
  "ТЕСТОВАЯ СРЕДА. Не использовать для реальных передач.";

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

export function tanTrackerUserTestBannerForApi(
  env: NodeJS.ProcessEnv = process.env,
): { userTestEnvironmentBanner: string | null } {
  return {
    userTestEnvironmentBanner: isTanTrackerUserTestEnv(env) ? TT56_USER_TEST_BANNER : null,
  };
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
