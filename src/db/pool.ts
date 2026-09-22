import { Pool, type PoolConfig, type QueryResult } from "pg";
import { getDatabaseUrl, getPgSslConfig } from "../config";

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

  const ssl = getPgSslConfig();
  const config: PoolConfig = {
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: ssl === false ? false : ssl,
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
