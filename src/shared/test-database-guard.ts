const TEST_DB_NAME = "tandoor_rf_test";
const TEST_DB_SUFFIX = "_test";
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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

export function assertLocalDatabaseHost(url: string, context = "operation"): void {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Refusing ${context}: invalid database URL.`);
  }
  if (!LOCAL_DATABASE_HOSTS.has(host)) {
    throw new Error(
      `Refusing ${context} on non-local database host "${host || "(empty)"}". Use 127.0.0.1, localhost, or ::1.`,
    );
  }
}

export function assertTestDatabaseUrl(url: string, context = "operation"): void {
  assertLocalDatabaseHost(url, context);
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
