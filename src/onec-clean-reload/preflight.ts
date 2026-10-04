import type { PoolClient } from "pg";
import { tryAcquireCatalogImportLock } from "../onec-catalog/import-lock";
import { IMPORT_ADVISORY_LOCK_KEY } from "../onec-clients/constants";
import { tryAcquireImportLock } from "../onec-clients/import-lock";
import { IMPORT_ADVISORY_LOCK_KEY as CATALOG_IMPORT_ADVISORY_LOCK_KEY } from "../onec-catalog/constants";
import { CLEAN_RELOAD_ADVISORY_LOCK_KEY, PURGE_TABLE_GROUPS } from "./constants";
import type { PinnedCleanReloadBundle, CleanReloadPlan } from "./types";
import { computeTargetDbFingerprint } from "./target-db";

export async function assertNoConcurrentImports(client: PoolClient): Promise<void> {
  const runningClients = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_client_import_runs
      WHERE status = 'running'
    `,
  );
  if (Number(runningClients.rows[0]?.count ?? "0") > 0) {
    throw Object.assign(new Error("A client import run is still marked as running."), {
      code: "CONCURRENT_CLIENT_IMPORT",
    });
  }

  const runningCatalog = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_catalog_import_runs
      WHERE status = 'running'
    `,
  );
  if (Number(runningCatalog.rows[0]?.count ?? "0") > 0) {
    throw Object.assign(new Error("A catalog import run is still marked as running."), {
      code: "CONCURRENT_CATALOG_IMPORT",
    });
  }

  const pendingJobs = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_import_jobs
      WHERE status IN ('pending', 'running')
    `,
  );
  if (Number(pendingJobs.rows[0]?.count ?? "0") > 0) {
    throw Object.assign(new Error("Pending or running onec_import_jobs must be resolved first."), {
      code: "PENDING_IMPORT_JOBS",
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

  const catalogImport = await tryAcquireCatalogImportLock(client);
  if (!catalogImport) {
    throw Object.assign(new Error("Catalog import advisory lock is held."), {
      code: "CATALOG_IMPORT_LOCKED",
    });
  }
  await client.query(`SELECT pg_advisory_unlock($1)`, [CATALOG_IMPORT_ADVISORY_LOCK_KEY]);
}

export function buildCleanReloadPlan(
  databaseUrl: string,
  bundle: PinnedCleanReloadBundle,
): CleanReloadPlan {
  return {
    targetDbFingerprint: computeTargetDbFingerprint(databaseUrl),
    bundleFingerprint: bundle.bundleFingerprint,
    catalogManifestSha256: bundle.catalogManifestSha256,
    clientsRecordCount: bundle.clientsPayload.recordCount,
    wholesaleEmployeeCount: bundle.employeeRoster.wholesaleCount,
    catalogProductCount: bundle.catalogData?.counts.products ?? 0,
    purgeScope: {
      tableGroups: [
        "client_orphans",
        ...PURGE_TABLE_GROUPS.catalogImages,
        ...PURGE_TABLE_GROUPS.catalogCore,
        ...PURGE_TABLE_GROUPS.clientDomain,
        "onec_exchange_state_reset",
        "onec_catalog_state_reset",
      ],
      orphanCleanupStatements: PURGE_TABLE_GROUPS.clientOrphans.length,
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
