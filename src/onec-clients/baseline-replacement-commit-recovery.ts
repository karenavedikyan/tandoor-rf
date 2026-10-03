import type { PoolClient } from "pg";
import {
  blockExchangeApply,
  withFreshPoolClient,
  type CommitUncertainResolution,
} from "../onec-exchange/state";
import { IMPORT_ADVISORY_LOCK_KEY } from "./constants";
import {
  captureDbBaselineStateWithDependencies,
  computeDbBaselineStateSha256,
} from "./baseline-replacement-db-state";
import { extractBaselineApplyResultMeta } from "./baseline-replacement-db";
import { loadArchiveDependencyContext } from "./baseline-replacement-preflight";

const BASELINE_COMMIT_UNCERTAIN_PATTERN =
  /BASELINE_COMMIT_UNCERTAIN for run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export async function resolveBaselineCommitUncertainOutcome(
  client: PoolClient,
  baselineRunId: string,
): Promise<CommitUncertainResolution> {
  const run = await client.query<{ status: string; plan_json: unknown; mode: string }>(
    `
      SELECT status, plan_json, mode
      FROM onec_baseline_replacement_runs
      WHERE id = $1::uuid
    `,
    [baselineRunId],
  );
  const row = run.rows[0];
  if (!row) {
    return "not_committed";
  }
  if (row.status === "success") {
    return "committed";
  }

  const meta = extractBaselineApplyResultMeta(row.plan_json);
  if (meta) {
    const dependencyContext = await loadArchiveDependencyContext(client);
    const capture = await captureDbBaselineStateWithDependencies(client, dependencyContext);
    const digest = computeDbBaselineStateSha256(capture);
    if (digest === meta.postApplyStateSha256.toLowerCase()) {
      await client.query(
        `
          UPDATE onec_baseline_replacement_runs
          SET status = 'success', finished_at = COALESCE(finished_at, NOW()), error_code = NULL
          WHERE id = $1::uuid
        `,
        [baselineRunId],
      );
      return "committed";
    }
  }

  if (row.status === "running") {
    return "not_committed";
  }

  if (row.status === "failed") {
    return "not_committed";
  }

  return "still_uncertain";
}

export async function resolveBaselineCommitUncertainFresh(
  databaseUrl: string,
  baselineRunId: string,
): Promise<CommitUncertainResolution> {
  return withFreshPoolClient(databaseUrl, async (client) => {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [IMPORT_ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      try {
        await blockExchangeApply(client, `BASELINE_COMMIT_UNCERTAIN for run ${baselineRunId}`);
      } catch {
        // Best-effort block when the import lock is still held elsewhere.
      }
      return "still_uncertain";
    }
    try {
      return await resolveBaselineCommitUncertainOutcome(client, baselineRunId);
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
      } catch {
        // Destroyed connections must not return to the pool.
      }
    }
  });
}

export function parseBaselineCommitUncertainRunId(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  const match = reason.match(BASELINE_COMMIT_UNCERTAIN_PATTERN);
  return match?.[1] ?? null;
}
