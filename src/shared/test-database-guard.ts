const TEST_DB_NAME = "tandoor_rf_test";
const TEST_DB_SUFFIX = "_test";

export function extractDatabaseName(url: string): string {
  try {
    const parsed = new URL(url);
    const fromPath = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (fromPath) {
      return fromPath;
    }
  } catch {
    // fall through for non-standard postgres URLs
  }

  const match = url.match(/\/([^/?]+)(?:\?|$)/);
  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }

  throw new Error("Invalid database URL.");
}

export function isAllowedTestDatabaseName(dbName: string): boolean {
  return dbName === TEST_DB_NAME || dbName.endsWith(TEST_DB_SUFFIX);
}

export function assertTestDatabaseUrl(url: string, context = "operation"): void {
  const dbName = extractDatabaseName(url);
  if (!isAllowedTestDatabaseName(dbName)) {
    throw new Error(
      `Refusing ${context} on non-test database "${dbName}". Use ${TEST_DB_NAME} or a *_test database.`,
    );
  }
}

export function getRequiredTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = env.TEST_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("TEST_DATABASE_URL is required for test-only scripts.");
  }
  assertTestDatabaseUrl(url, "test script");
  return url;
}
