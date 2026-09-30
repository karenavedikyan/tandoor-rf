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
  for (const [lockA, lockB] of heldLocks) {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [lockA, lockB]);
    } catch {
      // Best-effort unlock; connection may already be broken.
    }
  }
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
): Promise<
  | { ok: true; heldLocks: Array<[string, string]> }
  | { ok: false; code: "SYNC_IN_PROGRESS" | "COOLDOWN"; retryAfterMs: number }
> {
  const heldLocks: Array<[string, string]> = [];
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
      await unlockHeldLocks(client, heldLocks);
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
  let heldLocks: Array<[string, string]> = [];
  let broken = false;

  try {
    const result = await acquireLocksOnClient(client, portalId, taskIds, minIntervalMs);
    if (!result.ok) {
      client.release();
      return result;
    }
    heldLocks = result.heldLocks;
    const locksToRelease = heldLocks;
    return {
      ok: true,
      release: async () => {
        try {
          await unlockHeldLocks(client, locksToRelease);
        } finally {
          client.release(broken);
        }
      },
    };
  } catch (error) {
    broken = true;
    try {
      await unlockHeldLocks(client, heldLocks);
    } finally {
      client.release(true);
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
