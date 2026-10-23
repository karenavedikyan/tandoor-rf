import type { Pool, PoolClient } from "pg";

const PREFLIGHT_CONNECT_TIMEOUT_MS = 5_000;
const PREFLIGHT_STATEMENT_TIMEOUT_MS = 30_000;
const PREFLIGHT_LOCK_TIMEOUT_MS = 5_000;

export type ReadOnlySession = {
  client: PoolClient;
  pool: Pool;
};

export async function withReadOnlyPreflightSession<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query(`SET statement_timeout = '${PREFLIGHT_STATEMENT_TIMEOUT_MS}ms'`);
    await client.query(`SET lock_timeout = '${PREFLIGHT_LOCK_TIMEOUT_MS}ms'`);
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    txOpen = true;
    const result = await work(client);
    await client.query("COMMIT");
    txOpen = false;
    return result;
  } catch (error) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

export { PREFLIGHT_CONNECT_TIMEOUT_MS, PREFLIGHT_STATEMENT_TIMEOUT_MS, PREFLIGHT_LOCK_TIMEOUT_MS };
