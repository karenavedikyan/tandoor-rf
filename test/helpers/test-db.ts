import { Pool } from "pg";
import { runMigrations } from "../../src/db/migrate-runner";

const TEST_DB_MARKER = "_test";

export function getIntegrationDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Integration tests require TEST_DATABASE_URL or DATABASE_URL pointing to a test database.",
    );
  }
  assertTestDatabaseUrl(url);
  return url;
}

function extractDatabaseName(url: string): string {
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

  throw new Error("Invalid database URL for integration tests.");
}

export function assertTestDatabaseUrl(url: string): void {
  const dbName = extractDatabaseName(url);

  if (dbName !== "tandoor_rf_test" && !dbName.endsWith(TEST_DB_MARKER)) {
    throw new Error(
      `Refusing to run integration tests against non-test database "${dbName}". Use tandoor_rf_test.`,
    );
  }
}

export async function resetDatabase(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO PUBLIC;
    `);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function prepareDatabase(databaseUrl: string): Promise<void> {
  await resetDatabase(databaseUrl);
  await runMigrations({ databaseUrl });
}

export function setIntegrationEnv(databaseUrl: string, origin = "http://127.0.0.1:3000"): void {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGIN = origin;
  process.env.PGSSLMODE = "disable";
  process.env.TRUST_PROXY = "false";
  process.env.NODE_ENV = "test";
}

export async function createTestUser(input: {
  databaseUrl: string;
  email: string;
  password: string;
  fullName: string;
  role?: string;
  status?: string;
  phone?: string | null;
}): Promise<{ id: string }> {
  const { hashPassword } = await import("../../src/auth/password");
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  const passwordHash = await hashPassword(input.password);
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO users (email, password_hash, full_name, phone, role, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      input.email.trim().toLowerCase(),
      passwordHash,
      input.fullName,
      input.phone ?? null,
      input.role ?? "manager",
      input.status ?? "active",
    ],
  );
  await pool.end();
  return { id: result.rows[0]!.id };
}
