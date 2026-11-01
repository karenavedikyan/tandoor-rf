import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { resolveMigrationsDir } from "../db/migrate-runner";

const MIGRATION = "078_tt_admin_track_notifications.sql";
const TABLE = "public.tt_admin_track_notification_preferences";

/**
 * The production container starts server.js, not the general migration CLI.
 * Apply only this reviewed, additive migration before accepting requests or
 * starting delivery workers. Never run unrelated historical migrations here.
 */
export async function ensureAdminNotificationsSchema(pool: Pool): Promise<{ applied: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [902_451_001]);
    const existing = await client.query<{ name: string | null }>(
      "SELECT to_regclass($1)::text AS name", [TABLE],
    );
    const applied = !existing.rows[0]?.name;
    if (applied) {
      const sql = await fs.readFile(path.join(resolveMigrationsDir(), MIGRATION), "utf8");
      await client.query(sql);
    }
    // Verify the actual contract even if a migration receipt already exists.
    await client.query(
      "SELECT user_id,mode,enabled_since,updated_at FROM tt_admin_track_notification_preferences LIMIT 0",
    );
    await client.query(
      "INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
      [MIGRATION],
    );
    await client.query("COMMIT");
    return { applied };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
