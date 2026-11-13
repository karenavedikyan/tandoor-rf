import type { PoolClient } from "pg";

// Separate two-key advisory namespace, held for the WHOLE attempt, including FTP.
const WORKER_LEASE_NAMESPACE = 902_451_019;

export async function acquireWorkerLease(db: PoolClient, jobId: string): Promise<boolean> {
  const result = await db.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1::integer, hashtext($2::text)) AS locked",
    [WORKER_LEASE_NAMESPACE, jobId],
  );
  return result.rows[0]?.locked === true;
}

export async function releaseWorkerLease(db: PoolClient, jobId: string): Promise<void> {
  const result = await db.query<{ unlocked: boolean }>(
    "SELECT pg_advisory_unlock($1::integer, hashtext($2::text)) AS unlocked",
    [WORKER_LEASE_NAMESPACE, jobId],
  );
  if (result.rows[0]?.unlocked !== true) throw new Error("WORKER_LEASE_RELEASE_FAILED");
}

/** Caller must be in a transaction. Rollback also releases this recovery lock. */
export async function acquireRecoveryLease(db: PoolClient, jobId: string): Promise<boolean> {
  const result = await db.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock($1::integer, hashtext($2::text)) AS locked",
    [WORKER_LEASE_NAMESPACE, jobId],
  );
  return result.rows[0]?.locked === true;
}
