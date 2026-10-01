import { Pool, type PoolClient } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { IMPORT_ADVISORY_LOCK_KEY } from "./constants";

const FRESH_POOL_CONNECT_TIMEOUT_MS = 5_000;

export type CatalogStateRow = {
  active_version_id: string | null;
  last_successful_manifest_sha256: string | null;
  apply_blocked: boolean;
  apply_blocked_reason: string | null;
};

export type CommitUncertainResolution = "committed" | "not_committed" | "still_uncertain";

const COMMIT_UNCERTAIN_RUN_PATTERN =
  /COMMIT_UNCERTAIN for run ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export async function loadCatalogState(client: PoolClient): Promise<CatalogStateRow> {
  const result = await client.query<CatalogStateRow>(
    `
      SELECT active_version_id, last_successful_manifest_sha256, apply_blocked, apply_blocked_reason
      FROM onec_catalog_state
      WHERE id = 1
    `,
  );
  return (
    result.rows[0] ?? {
      active_version_id: null,
      last_successful_manifest_sha256: null,
      apply_blocked: false,
      apply_blocked_reason: null,
    }
  );
}

export async function blockCatalogApply(client: PoolClient, reason: string): Promise<void> {
  await client.query(
    `
      UPDATE onec_catalog_state
      SET apply_blocked = true, apply_blocked_reason = $1, updated_at = NOW()
      WHERE id = 1
    `,
    [reason],
  );
}

export async function clearCatalogApplyBlock(client: PoolClient): Promise<void> {
  await client.query(
    `
      UPDATE onec_catalog_state
      SET apply_blocked = false, apply_blocked_reason = NULL, updated_at = NOW()
      WHERE id = 1
    `,
  );
}

export async function clearApplyBlockedForRun(client: PoolClient, runId: string): Promise<void> {
  await client.query(
    `
      UPDATE onec_catalog_state
      SET apply_blocked = false, apply_blocked_reason = NULL, updated_at = NOW()
      WHERE id = 1 AND apply_blocked_reason LIKE $1
    `,
    [`%${runId}%`],
  );
}

export function parseCommitUncertainRunId(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const match = reason.match(COMMIT_UNCERTAIN_RUN_PATTERN);
  return match?.[1] ?? null;
}

async function markCatalogAppliedInTxn(
  client: PoolClient,
  input: { versionId: string; manifestSha256: string },
): Promise<void> {
  await client.query(
    `
      UPDATE onec_catalog_state
      SET
        active_version_id = $1::uuid,
        last_successful_manifest_sha256 = $2,
        apply_blocked = false,
        apply_blocked_reason = NULL,
        updated_at = NOW()
      WHERE id = 1
    `,
    [input.versionId, input.manifestSha256],
  );
}

export async function resolveCatalogCommitUncertainOutcome(
  client: PoolClient,
  runId: string,
): Promise<CommitUncertainResolution> {
  const runResult = await client.query<{
    status: string;
    manifest_sha256: string | null;
    applied_version_id: string | null;
    product_count: number | null;
  }>(
    `
      SELECT status, manifest_sha256, applied_version_id, product_count
      FROM onec_catalog_import_runs
      WHERE id = $1::uuid
    `,
    [runId],
  );
  const run = runResult.rows[0];
  if (!run) {
    try {
      await blockCatalogApply(client, `COMMIT_UNCERTAIN for run ${runId}`);
    } catch {
      return "still_uncertain";
    }
    return "still_uncertain";
  }

  if ((run.status === "success" || run.status === "partial") && run.applied_version_id && run.manifest_sha256) {
    const version = await client.query<{ is_active: boolean; manifest_sha256: string }>(
      `
        SELECT is_active, manifest_sha256
        FROM onec_catalog_versions
        WHERE id = $1::uuid
      `,
      [run.applied_version_id],
    );
    const row = version.rows[0];
    if (row?.is_active && row.manifest_sha256 === run.manifest_sha256) {
      await clearApplyBlockedForRun(client, runId);
      return "committed";
    }
  }

  if (run.status === "running" && run.manifest_sha256) {
    const active = await client.query<{ id: string; manifest_sha256: string; product_count: number }>(
      `
        SELECT id, manifest_sha256, product_count
        FROM onec_catalog_versions
        WHERE manifest_sha256 = $1 AND is_active = TRUE
        LIMIT 1
      `,
      [run.manifest_sha256],
    );
    const activeRow = active.rows[0];
    if (
      activeRow &&
      run.product_count !== null &&
      activeRow.product_count === run.product_count
    ) {
      await client.query(
        `
          UPDATE onec_catalog_import_runs
          SET status = 'partial', finished_at = COALESCE(finished_at, NOW()), error_code = NULL
          WHERE id = $1::uuid AND status = 'running'
        `,
        [runId],
      );
      await markCatalogAppliedInTxn(client, {
        versionId: activeRow.id,
        manifestSha256: run.manifest_sha256,
      });
      await clearApplyBlockedForRun(client, runId);
      return "committed";
    }

    try {
      await blockCatalogApply(client, `COMMIT_UNCERTAIN for run ${runId}`);
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

export async function resolveCatalogCommitUncertainFresh(
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
        await blockCatalogApply(client, `COMMIT_UNCERTAIN for run ${runId}`);
      } catch {
        // Best-effort block when import lock is still held elsewhere.
      }
      return "still_uncertain";
    }
    try {
      return await resolveCatalogCommitUncertainOutcome(client, runId);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
    }
  });
}
