import { getPool } from "./pool";

const REQUIRED_TABLES = ["users", "sessions", "login_rate_limits"] as const;

export type ReadinessResult =
  | { ready: true }
  | { ready: false; reason: "not_configured" | "unreachable" | "schema_missing" };

export async function checkReadiness(): Promise<ReadinessResult> {
  const pool = getPool();
  if (!pool) {
    return { ready: false, reason: "not_configured" };
  }

  let client;
  try {
    client = await pool.connect();
    for (const table of REQUIRED_TABLES) {
      const result = await client.query<{ regclass: string | null }>(
        "SELECT to_regclass($1) AS regclass",
        [`public.${table}`],
      );
      if (!result.rows[0]?.regclass) {
        return { ready: false, reason: "schema_missing" };
      }
    }
    return { ready: true };
  } catch {
    return { ready: false, reason: "unreachable" };
  } finally {
    client?.release();
  }
}
