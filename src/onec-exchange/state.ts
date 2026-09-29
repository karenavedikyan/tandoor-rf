import { Pool, type PoolClient } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { IMPORT_ADVISORY_LOCK_KEY } from "../onec-clients/constants";

const FRESH_POOL_CONNECT_TIMEOUT_MS = 5_000;

export type ExchangeStateRow = {
  last_attempt_at: Date | null;
  last_verified_at: Date | null;
  last_verified_sha256: string | null;
  last_checked_at: Date | null;
  last_checked_sha256: string | null;
  last_successful_apply_at: Date | null;
  last_successful_apply_sha256: string | null;
  accepted_baseline_sha256: string | null;
  last_source_modified_at: Date | null;
  apply_blocked: boolean;
  apply_blocked_reason: string | null;
};

export type CommitUncertainResolution = "committed" | "not_committed" | "still_uncertain";

const COMMIT_UNCERTAIN_RUN_PATTERN =
  /COMMIT_UNCERTAIN for run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export async function loadExchangeState(client: PoolClient): Promise<ExchangeStateRow> {
  const result = await client.query<ExchangeStateRow>(
    `
      SELECT
        last_attempt_at,
        last_verified_at,
        last_verified_sha256,
        last_checked_at,
        last_checked_sha256,
        last_successful_apply_at,
        last_successful_apply_sha256,
        accepted_baseline_sha256,
        last_source_modified_at,
        apply_blocked,
        apply_blocked_reason
      FROM onec_exchange_state
      WHERE id = 1
    `,
  );
  return (
    result.rows[0] ?? {
      last_attempt_at: null,
      last_verified_at: null,
      last_verified_sha256: null,
      last_checked_at: null,
      last_checked_sha256: null,
      last_successful_apply_at: null,
      last_successful_apply_sha256: null,
      accepted_baseline_sha256: null,
      last_source_modified_at: null,
      apply_blocked: false,
      apply_blocked_reason: null,
    }
  );
}

export async function markExchangeAttempt(client: PoolClient): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET last_attempt_at = NOW(), updated_at = NOW()
      WHERE id = 1
    `,
  );
}

export async function markExchangeVerified(
  client: PoolClient,
  input: { sha256: string; verifiedAt?: Date },
): Promise<void> {
  const verifiedAt = input.verifiedAt ?? new Date();
  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_attempt_at = $1,
        last_verified_at = $1,
        last_verified_sha256 = $2,
        last_checked_at = $1,
        last_checked_sha256 = $2,
        updated_at = NOW()
      WHERE id = 1
    `,
    [verifiedAt, input.sha256],
  );
}

export async function markExchangeApplied(
  client: PoolClient,
  input: {
    sha256: string;
    appliedAt?: Date;
    acceptedBaselineSha256?: string | null;
  },
): Promise<void> {
  const appliedAt = input.appliedAt ?? new Date();
  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_successful_apply_at = $1,
        last_successful_apply_sha256 = $2,
        last_verified_at = $1,
        last_verified_sha256 = $2,
        last_checked_at = $1,
        last_checked_sha256 = $2,
        accepted_baseline_sha256 = COALESCE($3, accepted_baseline_sha256, $2),
        apply_blocked = false,
        apply_blocked_reason = NULL,
        updated_at = NOW()
      WHERE id = 1
    `,
    [appliedAt, input.sha256, input.acceptedBaselineSha256 ?? null],
  );
}

export async function updateExchangeStateAfterApplyInTxn(
  client: PoolClient,
  input: {
    sha256: string;
    acceptedBaselineSha256?: string | null;
  },
): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_successful_apply_at = NOW(),
        last_successful_apply_sha256 = $1,
        last_verified_at = NOW(),
        last_verified_sha256 = $1,
        last_checked_at = NOW(),
        last_checked_sha256 = $1,
        accepted_baseline_sha256 = COALESCE($2, accepted_baseline_sha256, $1),
        apply_blocked = false,
        apply_blocked_reason = NULL,
        updated_at = NOW()
      WHERE id = 1
    `,
    [input.sha256, input.acceptedBaselineSha256 ?? null],
  );
}

export async function blockExchangeApply(
  client: PoolClient,
  reason: string,
): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET apply_blocked = true, apply_blocked_reason = $1, updated_at = NOW()
      WHERE id = 1
    `,
    [reason],
  );
}

async function queryLatestSuccessfulApplyJournal(client: PoolClient): Promise<{
  source_sha256: string;
  finished_at: Date;
} | null> {
  const fallback = await client.query<{ source_sha256: string; finished_at: Date }>(
    `
      SELECT source_sha256, finished_at
      FROM onec_client_import_runs
      WHERE status = 'success' AND mode = 'apply'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
  );
  return fallback.rows[0] ?? null;
}

/** Initialize exchange state from journal under advisory lock when table is empty after migration. */
export async function ensureExchangeStateInitialized(client: PoolClient): Promise<void> {
  const state = await loadExchangeState(client);
  if (state.last_successful_apply_sha256 && state.last_successful_apply_at) {
    return;
  }

  const journal = await queryLatestSuccessfulApplyJournal(client);
  if (!journal) {
    return;
  }

  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_successful_apply_at = COALESCE(last_successful_apply_at, $1),
        last_successful_apply_sha256 = COALESCE(last_successful_apply_sha256, $2),
        last_verified_at = COALESCE(last_verified_at, $1),
        last_verified_sha256 = COALESCE(last_verified_sha256, $2),
        last_checked_at = COALESCE(last_checked_at, $1),
        last_checked_sha256 = COALESCE(last_checked_sha256, $2),
        accepted_baseline_sha256 = COALESCE(accepted_baseline_sha256, $2),
        updated_at = NOW()
      WHERE id = 1
        AND (last_successful_apply_sha256 IS NULL OR last_successful_apply_at IS NULL)
    `,
    [journal.finished_at, journal.source_sha256],
  );
}

/** Unified committed snapshot SHA for scheduled, apply and sync-status. */
export async function getCommittedSnapshotSha(client: PoolClient): Promise<string | null> {
  await ensureExchangeStateInitialized(client);
  const state = await loadExchangeState(client);
  if (state.last_successful_apply_sha256) {
    return state.last_successful_apply_sha256;
  }
  const journal = await queryLatestSuccessfulApplyJournal(client);
  return journal?.source_sha256 ?? null;
}

/** @deprecated Use getCommittedSnapshotSha */
export async function getDbCommittedSnapshotSha(client: PoolClient): Promise<string | null> {
  return getCommittedSnapshotSha(client);
}

export function parseCommitUncertainRunId(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  const match = reason.match(COMMIT_UNCERTAIN_RUN_PATTERN);
  return match?.[1] ?? null;
}

async function clearApplyBlockedForRun(client: PoolClient, runId: string): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET apply_blocked = false, apply_blocked_reason = NULL, updated_at = NOW()
      WHERE id = 1
        AND apply_blocked_reason LIKE $1
    `,
    [`%${runId}%`],
  );
}

async function shouldSyncExchangeStateFromRun(
  client: PoolClient,
  runId: string,
  sha256: string,
): Promise<boolean> {
  const state = await loadExchangeState(client);
  if (!state.last_successful_apply_sha256 || state.last_successful_apply_sha256 === sha256) {
    return true;
  }

  const ordering = await client.query<{
    this_finished_at: Date | null;
    newer_finished_at: Date | null;
  }>(
    `
      SELECT
        this_run.finished_at AS this_finished_at,
        newer.finished_at AS newer_finished_at
      FROM onec_client_import_runs this_run
      LEFT JOIN onec_client_import_runs newer
        ON newer.status = 'success'
       AND newer.mode = 'apply'
       AND newer.source_sha256 = $2
       AND newer.id <> $1::uuid
       AND newer.finished_at IS NOT NULL
       AND (this_run.finished_at IS NULL OR newer.finished_at > this_run.finished_at)
      WHERE this_run.id = $1::uuid
      ORDER BY newer.finished_at DESC NULLS LAST
      LIMIT 1
    `,
    [runId, state.last_successful_apply_sha256],
  );

  return ordering.rows[0]?.newer_finished_at == null;
}

async function finalizeCommittedRun(
  client: PoolClient,
  runId: string,
  sha256: string,
): Promise<void> {
  const shouldSync = await shouldSyncExchangeStateFromRun(client, runId, sha256);
  if (shouldSync) {
    await markExchangeApplied(client, {
      sha256,
      acceptedBaselineSha256: sha256,
    });
  } else {
    await clearApplyBlockedForRun(client, runId);
  }
}

export async function resolveCommitUncertainOutcome(
  client: PoolClient,
  runId: string,
): Promise<CommitUncertainResolution> {
  const runResult = await client.query<{
    status: string;
    source_sha256: string | null;
    new_count: number | null;
    changed_count: number | null;
    unchanged_count: number | null;
  }>(
    `
      SELECT status, source_sha256, new_count, changed_count, unchanged_count
      FROM onec_client_import_runs
      WHERE id = $1::uuid
    `,
    [runId],
  );
  const run = runResult.rows[0];
  if (!run) {
    try {
      await blockExchangeApply(client, `COMMIT_UNCERTAIN for run ${runId}`);
    } catch {
      return "still_uncertain";
    }
    return "still_uncertain";
  }

  if (run.status === "success" && run.source_sha256) {
    await finalizeCommittedRun(client, runId, run.source_sha256);
    return "committed";
  }

  if (run.status === "running" && run.source_sha256) {
    const clients = await client.query<{ source_sha256: string; count: string }>(
      `
        SELECT source_sha256, COUNT(*)::text AS count
        FROM onec_clients
        GROUP BY source_sha256
      `,
    );
    const totalClients = clients.rows.reduce((sum, row) => sum + Number(row.count), 0);
    const matchingSha = clients.rows.find((row) => row.source_sha256 === run.source_sha256);
    const expectedRecords =
      (run.new_count ?? 0) + (run.changed_count ?? 0) + (run.unchanged_count ?? 0);

    if (
      matchingSha &&
      Number(matchingSha.count) === totalClients &&
      totalClients > 0 &&
      totalClients === expectedRecords
    ) {
      await client.query(
        `
          UPDATE onec_client_import_runs
          SET status = 'success', finished_at = COALESCE(finished_at, NOW()), error_code = NULL
          WHERE id = $1::uuid AND status = 'running'
        `,
        [runId],
      );
      await finalizeCommittedRun(client, runId, run.source_sha256);
      return "committed";
    }

    try {
      await blockExchangeApply(client, `COMMIT_UNCERTAIN for run ${runId}`);
    } catch {
      return "still_uncertain";
    }
    return "still_uncertain";
  }

  await clearApplyBlockedForRun(client, runId);
  return "not_committed";
}

function createFreshPool(databaseUrl: string): Pool {
  const pgOptions = createPgPoolOptions(databaseUrl);
  return new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: FRESH_POOL_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });
}

export async function withFreshPoolClient<T>(
  databaseUrl: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = createFreshPool(databaseUrl);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function resolveCommitUncertainFresh(
  databaseUrl: string,
  runId: string,
): Promise<CommitUncertainResolution> {
  return withFreshPoolClient(databaseUrl, async (client) => {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [IMPORT_ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      try {
        await blockExchangeApply(client, `COMMIT_UNCERTAIN for run ${runId}`);
      } catch {
        // Best-effort block when the import lock is still held elsewhere.
      }
      return "still_uncertain";
    }
    try {
      return await resolveCommitUncertainOutcome(client, runId);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
    }
  });
}
