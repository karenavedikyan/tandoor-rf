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

/**
 * Ends the apply session after COMMIT dispatch uncertainty so recovery (marker/reconcile)
 * is not blocked by an open transaction on the original connection. Does not treat
 * ROLLBACK as proof of commit failure — connection end is idempotent cleanup only.
 */
export async function retireMatchedOnlySessionAfterCommitUncertainty(
  client: PoolClient,
  pool: Pool,
  lockHeld: boolean,
): Promise<void> {
  if (lockHeld) {
    await safeReleaseImportLock(client);
  }
  try {
    client.release(new Error("Commit uncertainty; retiring original session."));
  } catch {
    try {
      await client.end();
    } catch {
      /* Client may already be ended or released. */
    }
  }
  try {
    await pool.end();
  } catch {
    /* Pool shutdown is best-effort after a faulted session. */
  }
}
