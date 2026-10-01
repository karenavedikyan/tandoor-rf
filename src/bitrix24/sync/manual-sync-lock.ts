import type { PoolClient } from "pg";
import { requirePool } from "../../db/pool";

export type ManualSyncLockResult =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; code: "SYNC_IN_PROGRESS" | "COOLDOWN"; retryAfterMs: number };

export type ManualSyncCardSession =
  | {
      ok: true;
      acquireTaskLocks: (taskIds: string[]) => Promise<ManualSyncLockResult>;
      acquireHoldingLock: (holdingGuid: string) => Promise<ManualSyncLockResult>;
      release: () => Promise<void>;
    }
  | { ok: false; code: "SYNC_IN_PROGRESS" | "COOLDOWN"; retryAfterMs: number };

function manualSyncLockKey(portalId: string, taskId: string): [string, string] {
  return [portalId, `manual_sync:${taskId}`];
}

function manualSyncCardLockKey(portalId: string, cardGuid: string, userId: string): [string, string] {
  return [portalId, `manual_sync:card:${cardGuid}:${userId}`];
}

function manualSyncHoldingLockKey(portalId: string, holdingGuid: string): [string, string] {
  return [portalId, `manual_sync:holding:${holdingGuid}`];
}

function manualSyncAdmissionSlotKey(slot: number): [string, string] {
  return ["manual_sync_admission", String(slot)];
}

/** Reserve pool headroom: pool max=5, at most 3 concurrent card sessions. */
export const MANUAL_SYNC_ADMISSION_SLOT_COUNT = 3;

export type BeginManualSyncCardSessionOptions = {
  /** Wall-clock deadline for admission wait (includes DB, not only HTTP). */
  admissionDeadlineMs?: number;
};

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

async function tryAcquireAdvisoryLock(
  client: PoolClient,
  lockA: string,
  lockB: string,
  heldLocks: Array<[string, string]>,
  minIntervalMs: number,
): Promise<{ ok: true } | { ok: false; code: "SYNC_IN_PROGRESS"; retryAfterMs: number }> {
  const acquired = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked`,
    [lockA, lockB],
  );
  if (!acquired.rows[0]?.locked) {
    return { ok: false, code: "SYNC_IN_PROGRESS", retryAfterMs: minIntervalMs };
  }
  heldLocks.push([lockA, lockB]);
  return { ok: true };
}

async function checkAndRecordCardCooldown(
  client: PoolClient,
  portalId: string,
  cardGuid: string,
  userId: string,
  minIntervalMs: number,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  await client.query("BEGIN");
  try {
    const existing = await client.query<{ last_started_at: Date }>(
      `SELECT last_started_at
       FROM bitrix24_manual_sync_card_cooldown
       WHERE portal_id = $1 AND card_guid = $2::uuid AND user_id = $3::uuid
       FOR UPDATE`,
      [portalId, cardGuid, userId],
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
      `INSERT INTO bitrix24_manual_sync_card_cooldown (portal_id, card_guid, user_id, last_started_at)
       VALUES ($1, $2::uuid, $3::uuid, NOW())
       ON CONFLICT (portal_id, card_guid, user_id) DO UPDATE SET
         last_started_at = EXCLUDED.last_started_at`,
      [portalId, cardGuid, userId],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function tryAcquireAdmissionSlot(
  client: PoolClient,
  heldLocks: Array<[string, string]>,
  minIntervalMs: number,
  admissionDeadlineMs?: number,
): Promise<{ ok: true } | { ok: false; code: "SYNC_IN_PROGRESS"; retryAfterMs: number }> {
  if (admissionDeadlineMs !== undefined && Date.now() >= admissionDeadlineMs) {
    return { ok: false, code: "SYNC_IN_PROGRESS", retryAfterMs: minIntervalMs };
  }
  for (let slot = 0; slot < MANUAL_SYNC_ADMISSION_SLOT_COUNT; slot += 1) {
    const [lockA, lockB] = manualSyncAdmissionSlotKey(slot);
    const acquired = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked`,
      [lockA, lockB],
    );
    if (acquired.rows[0]?.locked) {
      heldLocks.push([lockA, lockB]);
      return { ok: true };
    }
  }
  // Never wait while holding a pool connection: contenders must leave capacity
  // for admitted sessions' verification/cache queries.
  return { ok: false, code: "SYNC_IN_PROGRESS", retryAfterMs: minIntervalMs };
}

/** Single-connection card session: admission + card lock before external HTTP. */
export async function beginManualSyncCardSession(
  portalId: string,
  cardGuid: string,
  userId: string,
  minIntervalMs = loadManualSyncMinIntervalMs(),
  options: BeginManualSyncCardSessionOptions = {},
): Promise<ManualSyncCardSession> {
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
        broken = true;
      } finally {
        client.release(broken);
      }
    })();
    return releasePromise;
  };

  try {
    const admission = await tryAcquireAdmissionSlot(
      client,
      heldLocks,
      minIntervalMs,
      options.admissionDeadlineMs,
    );
    if (!admission.ok) {
      await unlockHeldLocks(client, heldLocks);
      client.release();
      return admission;
    }

    const [lockA, lockB] = manualSyncCardLockKey(portalId, cardGuid, userId);
    const acquired = await tryAcquireAdvisoryLock(client, lockA, lockB, heldLocks, minIntervalMs);
    if (!acquired.ok) {
      await unlockHeldLocks(client, heldLocks);
      client.release();
      return acquired;
    }

    const cooldown = await checkAndRecordCardCooldown(client, portalId, cardGuid, userId, minIntervalMs);
    if (!cooldown.ok) {
      await unlockHeldLocks(client, heldLocks);
      client.release();
      return { ok: false, code: "COOLDOWN", retryAfterMs: cooldown.retryAfterMs };
    }

    return {
      ok: true,
      acquireTaskLocks: async (taskIds: string[]) => {
        if (taskIds.length === 0) {
          return { ok: true, release: async () => {} };
        }
        const result = await acquireLocksOnClient(
          client,
          portalId,
          [...new Set(taskIds)].sort(),
          minIntervalMs,
          heldLocks,
        );
        if (!result.ok) {
          return result;
        }
        return { ok: true, release: async () => {} };
      },
      acquireHoldingLock: async (holdingGuid: string) => {
        const [hA, hB] = manualSyncHoldingLockKey(portalId, holdingGuid);
        const holding = await tryAcquireAdvisoryLock(client, hA, hB, heldLocks, minIntervalMs);
        if (!holding.ok) {
          return holding;
        }
        return { ok: true, release: async () => {} };
      },
      release,
    };
  } catch (error) {
    if (!releasePromise) {
      client.release(true);
      releasePromise = Promise.resolve();
    }
    throw error;
  }
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

export async function acquireManualSyncCardLock(
  portalId: string,
  cardGuid: string,
  userId: string,
  minIntervalMs = loadManualSyncMinIntervalMs(),
): Promise<ManualSyncLockResult> {
  const session = await beginManualSyncCardSession(portalId, cardGuid, userId, minIntervalMs);
  if (!session.ok) {
    return session;
  }
  return { ok: true, release: session.release };
}
