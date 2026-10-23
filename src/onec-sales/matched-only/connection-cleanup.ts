import type { Pool, PoolClient } from "pg";
import { releaseImportLock } from "../../onec-clients/import-lock";

export async function safeReleaseImportLock(client: PoolClient): Promise<void> {
  try {
    await releaseImportLock(client);
  } catch {
    /* Connection may already be closed; server releases advisory lock on disconnect. */
  }
}

export async function safeDisposeMatchedOnlySession(
  client: PoolClient,
  pool: Pool,
  lockHeld: boolean,
): Promise<void> {
  if (lockHeld) {
    await safeReleaseImportLock(client);
  }
  try {
    client.release();
  } catch {
    /* Client may already be ended or released. */
  }
  try {
    await pool.end();
  } catch {
    /* Pool shutdown is best-effort after a faulted session. */
  }
}
