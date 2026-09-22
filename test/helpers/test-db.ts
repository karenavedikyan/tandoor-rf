import { Pool } from "pg";
import { runMigrations } from "../../src/db/migrate-runner";
import {
  assertTestDatabaseUrl,
  getRequiredTestDatabaseUrl,
} from "../../src/shared/test-database-guard";

export function getIntegrationDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (url) {
    assertTestDatabaseUrl(url, "integration tests");
    return url;
  }

  const fallback = process.env.DATABASE_URL?.trim();
  if (fallback) {
    assertTestDatabaseUrl(fallback, "integration tests");
    return fallback;
  }

  throw new Error(
    "Integration tests require TEST_DATABASE_URL (preferred) or DATABASE_URL pointing to a test database.",
  );
}

export { assertTestDatabaseUrl, getRequiredTestDatabaseUrl };

export async function resetDatabase(databaseUrl: string): Promise<void> {
  assertTestDatabaseUrl(databaseUrl, "resetDatabase");
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
  assertTestDatabaseUrl(databaseUrl, "prepareDatabase");
  await resetDatabase(databaseUrl);
  await runMigrations({ databaseUrl });
}

export function setIntegrationEnv(databaseUrl: string, origin = "http://127.0.0.1:3000"): void {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGIN = origin;
  process.env.PGSSLMODE = "disable";
  process.env.TRUSTED_PROXIES = "";
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
  assertTestDatabaseUrl(input.databaseUrl, "createTestUser");
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
