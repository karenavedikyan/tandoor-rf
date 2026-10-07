import type { PoolClient } from "pg";
import { getPool } from "../db/pool";
import { kickImportJobWorker } from "../onec-import/worker-scheduler";
import { tryEnqueueRegularUpdateJob } from "../clients/admin-onec-update/repository";
import {
  loadNightlyExchangeConfig,
  type NightlyExchangeConfig,
  type NightlyExchangeEnabledConfig,
} from "./config";
import { resolveActiveNightlyWindow } from "./msk-time";

export const NIGHTLY_EXCHANGE_SCHEDULER_LOCK = 902_451_005;

export type NightlyExchangeTickResult =
  | { status: "disabled" }
  | { status: "config_error"; error: string }
  | { status: "outside_window" }
  | { status: "already_claimed"; windowKey: string }
  | { status: "blocked"; code: string; message: string; windowKey: string }
  | { status: "enqueued"; jobId: string; windowKey: string }
  | { status: "database_unavailable" };

async function readClaimedWindow(client: PoolClient): Promise<string | null> {
  const result = await client.query<{ nightly_exchange_last_window: string | null }>(
    `SELECT nightly_exchange_last_window FROM onec_exchange_state WHERE id = 1`,
  );
  return result.rows[0]?.nightly_exchange_last_window ?? null;
}

async function claimNightlyWindow(client: PoolClient, windowKey: string): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET nightly_exchange_last_window = $1, updated_at = NOW()
      WHERE id = 1
    `,
    [windowKey],
  );
}

type TickInput = {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Test injection bypassing env loader. */
  config?: NightlyExchangeConfig;
};

function resolveTickConfig(input: TickInput): NightlyExchangeTickResult | { enabled: true; config: NightlyExchangeEnabledConfig } {
  if (input.config) {
    if (!input.config.enabled) {
      return { status: "disabled" };
    }
    return {
      enabled: true,
      config: {
        scheduleTime: input.config.scheduleTime,
        timezone: input.config.timezone,
        windowMinutes: input.config.windowMinutes,
      },
    };
  }

  const loaded = loadNightlyExchangeConfig(input.env ?? process.env);
  if (!loaded.ok) {
    return { status: "config_error", error: loaded.error };
  }
  if (!loaded.enabled) {
    return { status: "disabled" };
  }
  return { enabled: true, config: loaded.config };
}

export async function tickNightlyExchangeScheduler(input?: TickInput): Promise<NightlyExchangeTickResult> {
  const resolved = resolveTickConfig(input ?? {});
  if ("status" in resolved) {
    return resolved;
  }

  const now = input?.now ?? new Date();
  const activeWindow = resolveActiveNightlyWindow({
    now,
    scheduleTime: resolved.config.scheduleTime,
    windowMinutes: resolved.config.windowMinutes,
  });
  if (!activeWindow) {
    return { status: "outside_window" };
  }

  const pool = getPool();
  if (!pool) {
    return { status: "database_unavailable" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [NIGHTLY_EXCHANGE_SCHEDULER_LOCK]);

    const claimed = await readClaimedWindow(client);
    if (claimed === activeWindow.windowKey) {
      await client.query("COMMIT");
      return { status: "already_claimed", windowKey: activeWindow.windowKey };
    }

    const enqueued = await tryEnqueueRegularUpdateJob(
      {
        jobSource: "nightly",
        windowKey: activeWindow.windowKey,
        windowDeadlineAt: activeWindow.deadlineAt,
        requestedAt: now,
      },
      client,
    );

    await claimNightlyWindow(client, activeWindow.windowKey);

    if (!enqueued.ok) {
      await client.query("COMMIT");
      return {
        status: "blocked",
        code: enqueued.code,
        message: enqueued.message,
        windowKey: activeWindow.windowKey,
      };
    }

    await client.query("COMMIT");
    kickImportJobWorker();
    return { status: "enqueued", jobId: enqueued.jobId, windowKey: activeWindow.windowKey };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

/** In-process tick loop; disabled unless ONEC_NIGHTLY_EXCHANGE_ENABLED=true with valid config. */
export function startNightlyExchangeScheduler(env: NodeJS.ProcessEnv = process.env): void {
  const loaded = loadNightlyExchangeConfig(env);
  if (!loaded.ok) {
    console.error(
      JSON.stringify({
        event: "onec_nightly_exchange_config_invalid",
        error: loaded.error,
      }),
    );
    return;
  }
  if (!loaded.enabled) {
    return;
  }
  if (schedulerTimer) {
    return;
  }
  const intervalMs = 60_000;
  schedulerTimer = setInterval(() => {
    void tickNightlyExchangeScheduler({ env }).catch((error) => {
      console.error(
        JSON.stringify({
          event: "onec_nightly_exchange_tick_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    });
  }, intervalMs);
  schedulerTimer.unref?.();
  void tickNightlyExchangeScheduler({ env }).catch((error) => {
    console.error(
      JSON.stringify({
        event: "onec_nightly_exchange_initial_tick_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  });
}

/** Test-only: stop in-process scheduler between cases. */
export function stopNightlyExchangeSchedulerForTests(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
