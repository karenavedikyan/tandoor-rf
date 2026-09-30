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

export async function acquireManualSyncLock(
  portalId: string,
  taskId: string,
  minIntervalMs = loadManualSyncMinIntervalMs(),
): Promise<ManualSyncLockResult> {
  const pool = requirePool();
  const client = await pool.connect();
  const [lockA, lockB] = manualSyncLockKey(portalId, taskId);
  const acquired = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked`,
    [lockA, lockB],
  );
  if (!acquired.rows[0]?.locked) {
    client.release();
    return { ok: false, code: "SYNC_IN_PROGRESS", retryAfterMs: minIntervalMs };
  }

  try {
    const cooldown = await checkAndRecordCooldown(client, portalId, taskId, minIntervalMs);
    if (!cooldown.ok) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [lockA, lockB]);
      client.release();
      return { ok: false, code: "COOLDOWN", retryAfterMs: cooldown.retryAfterMs };
    }
  } catch (error) {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [lockA, lockB]);
    client.release();
    throw error;
  }

  return {
    ok: true,
    release: async () => {
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [lockA, lockB]);
      } finally {
        client.release();
      }
    },
  };
}
