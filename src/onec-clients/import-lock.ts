import type { PoolClient } from "pg";
import { IMPORT_ADVISORY_LOCK_KEY } from "./constants";

export async function tryAcquireImportLock(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [IMPORT_ADVISORY_LOCK_KEY],
  );
  return result.rows[0]?.locked === true;
}

export async function releaseImportLock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
}
