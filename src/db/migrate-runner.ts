import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { getDatabaseUrl, getPgSslConfig } from "../config";

const MIGRATION_LOCK_KEY = 902_451_001;

export function resolveMigrationsDir(): string {
  const bundled = path.join(__dirname, "..", "..", "server", "migrations");
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return path.join(process.cwd(), "server", "migrations");
}

function listMigrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export async function runMigrations(options?: { databaseUrl?: string }): Promise<string[]> {
  const databaseUrl = options?.databaseUrl ?? getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const ssl = getPgSslConfig();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: ssl === false ? false : ssl,
  });

  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query("BEGIN");
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [MIGRATION_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Another migration process is already running.");
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = resolveMigrationsDir();
    const files = listMigrationFiles(migrationsDir);
    const appliedRows = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const appliedSet = new Set(appliedRows.rows.map((row) => row.filename));

    for (const filename of files) {
      if (appliedSet.has(filename)) {
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename],
      );
      applied.push(filename);
    }

    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } catch {
      // ignore unlock failure after rollback
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
