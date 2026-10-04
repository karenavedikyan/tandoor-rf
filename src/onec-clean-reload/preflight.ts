import type { PoolClient } from "pg";
import { IMPORT_ADVISORY_LOCK_KEY } from "../onec-clients/constants";
import { tryAcquireImportLock } from "../onec-clients/import-lock";
import { CLEAN_RELOAD_ADVISORY_LOCK_KEY, PURGE_TABLE_GROUPS } from "./constants";
import { assertCleanReloadSchemaReady, inspectCleanReloadSchema } from "./schema-preflight";
import type { CleanReloadPlan, PinnedCleanReloadBundle } from "./types";
import { computeTargetDbFingerprint, parseTargetDbDisplay } from "./target-db";

export type ConcurrentImportState = {
  runningClientImports: number;
  pendingImportJobs: number;
};

export async function readConcurrentImportState(client: PoolClient): Promise<ConcurrentImportState> {
  const runningClients = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_client_import_runs
      WHERE status = 'running'
    `,
  );
  const pendingJobs = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_import_jobs
      WHERE status IN ('pending', 'running')
    `,
  );
  return {
    runningClientImports: Number(runningClients.rows[0]?.count ?? "0"),
    pendingImportJobs: Number(pendingJobs.rows[0]?.count ?? "0"),
  };
}

export function buildConcurrentImportBlockers(state: ConcurrentImportState): string[] {
  const blockers: string[] = [];
  if (state.runningClientImports > 0) {
    blockers.push("CONCURRENT_CLIENT_IMPORT");
  }
  if (state.pendingImportJobs > 0) {
    blockers.push("PENDING_IMPORT_JOBS");
  }
  return blockers;
}

/** Dry-run contract: refuse when imports/jobs are active; apply supersedes pending jobs under locks. */
export async function assertDryRunConcurrentImportsClear(client: PoolClient): Promise<void> {
  const state = await readConcurrentImportState(client);
  const blockers = buildConcurrentImportBlockers(state);
  if (blockers.includes("CONCURRENT_CLIENT_IMPORT")) {
    throw Object.assign(new Error("A client import run is still marked as running."), {
      code: "CONCURRENT_CLIENT_IMPORT",
    });
  }
  if (blockers.includes("PENDING_IMPORT_JOBS")) {
    throw Object.assign(new Error("Pending or running onec_import_jobs must be resolved before dry-run."), {
      code: "PENDING_IMPORT_JOBS",
    });
  }
}

/** Apply contract: only running client imports block; pending jobs are superseded after locks. */
export async function assertApplyConcurrentImportsClear(client: PoolClient): Promise<void> {
  const state = await readConcurrentImportState(client);
  if (state.runningClientImports > 0) {
    throw Object.assign(new Error("A client import run is still marked as running."), {
      code: "CONCURRENT_CLIENT_IMPORT",
    });
  }
}

export async function tryAcquireCleanReloadLock(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [CLEAN_RELOAD_ADVISORY_LOCK_KEY],
  );
  return result.rows[0]?.locked === true;
}

export async function releaseCleanReloadLock(client: PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock($1)`, [CLEAN_RELOAD_ADVISORY_LOCK_KEY]);
}

export async function assertCleanReloadLocksAvailable(client: PoolClient): Promise<void> {
  const cleanReload = await tryAcquireCleanReloadLock(client);
  if (!cleanReload) {
    throw Object.assign(new Error("Another clean reload is already in progress."), {
      code: "CLEAN_RELOAD_LOCKED",
    });
  }
  await releaseCleanReloadLock(client);

  const clientImport = await tryAcquireImportLock(client);
  if (!clientImport) {
    throw Object.assign(new Error("Client import advisory lock is held."), {
      code: "IMPORT_LOCKED",
    });
  }
  await client.query(`SELECT pg_advisory_unlock($1)`, [IMPORT_ADVISORY_LOCK_KEY]);
}

export function buildCleanReloadPlan(
  databaseUrl: string,
  bundle: PinnedCleanReloadBundle,
  schema: { dependencies: string[]; missing: string[] },
  concurrent: ConcurrentImportState,
): CleanReloadPlan {
  const tableGroups = [
    "client_orphans",
    ...PURGE_TABLE_GROUPS.clientDomain,
    ...PURGE_TABLE_GROUPS.rosterDomain,
    "onec_exchange_state_reset",
    "outlet_distribution_markers_optional",
    "client_review_records_optional",
  ];

  const blockers = [
    ...schema.missing.map((item) => `MIGRATIONS_NOT_READY:${item}`),
    ...buildConcurrentImportBlockers(concurrent),
  ];

  return {
    targetDbFingerprint: computeTargetDbFingerprint(databaseUrl),
    targetDb: parseTargetDbDisplay(databaseUrl),
    bundleFingerprint: bundle.bundleFingerprint,
    stats: bundle.stats,
    schemaDependencies: schema.dependencies,
    blockers,
    purgeScope: {
      tableGroups,
      orphanCleanupStatements: PURGE_TABLE_GROUPS.clientOrphans.length,
      catalogUntouched: true,
    },
  };
}

export async function supersedePendingImportJobs(client: PoolClient): Promise<number> {
  const result = await client.query(
    `
      UPDATE onec_import_jobs
      SET status = 'failed',
          finished_at = NOW(),
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'errorCode', 'CLEAN_RELOAD_SUPERSEDED',
            'message', 'Superseded by onec-clean-reload apply.'
          )
      WHERE status IN ('pending', 'running')
    `,
  );
  return result.rowCount ?? 0;
}

export async function runCleanReloadPreflight(
  client: PoolClient,
  mode: "dry_run" | "apply",
): Promise<{ schema: Awaited<ReturnType<typeof inspectCleanReloadSchema>>; concurrent: ConcurrentImportState }> {
  await assertCleanReloadSchemaReady(client);
  const schema = await inspectCleanReloadSchema(client);
  const concurrent = await readConcurrentImportState(client);
  if (mode === "dry_run") {
    await assertDryRunConcurrentImportsClear(client);
  } else {
    await assertApplyConcurrentImportsClear(client);
  }
  await assertCleanReloadLocksAvailable(client);
  return { schema, concurrent };
}
