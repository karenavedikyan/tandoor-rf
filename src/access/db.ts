import type { PoolClient } from "pg";
import { getPool } from "../db/pool";

export type TransactionClient = PoolClient;

export async function withTransaction<T>(
  fn: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_UNAVAILABLE");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class AccessServiceError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "VALIDATION",
  ) {
    super(message);
    this.name = "AccessServiceError";
  }
}
