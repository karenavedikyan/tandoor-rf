import type { PoolClient } from "pg";
import { requirePool } from "../../db/pool";

export type ManualSyncLockResult =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; code: "SYNC_IN_PROGRESS" | "COOLDOWN"; retryAfterMs: number };

function manualSyncLockKey(portalId: string, taskId: string): [string, string] {
  return [portalId, `manual_sync:${taskId}`];
}

export function loadManualSyncMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BITRIX24_MANUAL_SYNC_MIN_INTERVAL_MS?.trim() || "30000");
  if (!Number.isInteger(raw) || raw < 0) {
    return 30_000;
  }
  return raw;
}

async function unlockHeldLocks(client: PoolClient, heldLocks: Array<[string, string]>): Promise<void> {
  let failed = false;
  for (const [lockA, lockB] of heldLocks) {
    try {
      const result = await client.query<{ unlocked: boolean }>(
        `SELECT pg_advisory_unlock(hashtext($1), hashtext($2)) AS unlocked`, [lockA, lockB],
      );
      if (!result.rows[0]?.unlocked) failed = true;
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("MANUAL_SYNC_UNLOCK_FAILED");
}

async function checkAndRecordCooldown(
  client: PoolClient,
  portalId: string,
  taskId: string,
  minIntervalMs: number,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  await client.query("BEGIN");
  try {
    const existing = await client.query<{ last_started_at: Date }>(
      `SELECT last_started_at
       FROM bitrix24_manual_sync_cooldown
       WHERE portal_id = $1 AND task_id = $2
       FOR UPDATE`,
      [portalId, taskId],
    );
    const prior = existing.rows[0];
    const nowMs = Date.now();
    if (prior) {
      const elapsedMs = nowMs - prior.last_started_at.getTime();
      if (elapsedMs < minIntervalMs) {
        await client.query("ROLLBACK");
        return { ok: false, retryAfterMs: minIntervalMs - elapsedMs };
      }
    }
    await client.query(
      `INSERT INTO bitrix24_manual_sync_cooldown (portal_id, task_id, last_started_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (portal_id, task_id) DO UPDATE SET
         last_started_at = EXCLUDED.last_started_at`,
      [portalId, taskId],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function acquireLocksOnClient(
  client: PoolClient,
  portalId: string,
  taskIds: string[],
  minIntervalMs: number,
  heldLocks: Array<[string, string]>,
): Promise<
  | { ok: true; heldLocks: Array<[string, string]> }
  | { ok: false; code: "SYNC_IN_PROGRESS" | "COOLDOWN"; retryAfterMs: number }
> {
  for (const taskId of taskIds) {
    const [lockA, lockB] = manualSyncLockKey(portalId, taskId);
    const acquired = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked`,
      [lockA, lockB],
    );
    if (!acquired.rows[0]?.locked) {
      return { ok: false, code: "SYNC_IN_PROGRESS", retryAfterMs: minIntervalMs };
    }
    heldLocks.push([lockA, lockB]);

    const cooldown = await checkAndRecordCooldown(client, portalId, taskId, minIntervalMs);
    if (!cooldown.ok) {
      return { ok: false, code: "COOLDOWN", retryAfterMs: cooldown.retryAfterMs };
    }
  }
  return { ok: true, heldLocks };
}

export async function acquireManualSyncLocks(
  portalId: string,
  taskIds: string[],
  minIntervalMs = loadManualSyncMinIntervalMs(),
): Promise<ManualSyncLockResult> {
  if (taskIds.length === 0) {
    return { ok: true, release: async () => {} };
  }

  const pool = requirePool();
  const client = await pool.connect();
  const heldLocks: Array<[string, string]> = [];
  let releasePromise: Promise<void> | undefined;
  const release = (): Promise<void> => {
    releasePromise ??= (async () => {
      let broken = false;
      try {
        await unlockHeldLocks(client, heldLocks);
      } catch {
        // Never put a session with uncertain lock ownership back into the pool.
        broken = true;
      } finally {
        client.release(broken);
      }
    })();
    return releasePromise;
  };

  try {
    const result = await acquireLocksOnClient(
      client, portalId, [...new Set(taskIds)].sort(), minIntervalMs, heldLocks,
    );
    if (!result.ok) {
      await release();
      return result;
    }
    return { ok: true, release };
  } catch (error) {
    if (!releasePromise) {
      // Connection/transaction state is unknown after an acquisition error.
      client.release(true);
      releasePromise = Promise.resolve();
    }
    throw error;
  }
}

export async function acquireManualSyncLock(
  portalId: string,
  taskId: string,
  minIntervalMs = loadManualSyncMinIntervalMs(),
): Promise<ManualSyncLockResult> {
  return acquireManualSyncLocks(portalId, [taskId], minIntervalMs);
}
