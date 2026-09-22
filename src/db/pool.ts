import { Pool, type PoolConfig, type QueryResult } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { getDatabaseUrl } from "../config";

let pool: Pool | null | undefined;

export function getPool(): Pool | null {
  if (pool !== undefined) {
    return pool;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    pool = null;
    return null;
  }

  const pgOptions = createPgPoolOptions(databaseUrl);
  const config: PoolConfig = {
    connectionString: pgOptions.connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  };

  pool = new Pool(config);
  pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL pool error");
    console.error(err.message.slice(0, 200));
  });

  return pool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("DATABASE_UNAVAILABLE");
  }
  return activePool.query<T>(text, params);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export function resetPoolForTests(): void {
  pool = undefined;
}
