import { Pool, type PoolClient } from "pg";
import { runCatalogImageSync } from "../catalog/image-sync";
import { applyCatalogImport } from "../onec-catalog/apply";
import { applyClientsImport } from "../onec-clients/apply";
import {
  buildExtendedContractConfirmation,
  extendedContractConfirmationSha256,
} from "../onec-clients/extended-contract-gate";
import { isExtendedApplyPayload } from "../onec-clients/extended-apply";
import { storeExtendedContractConfirmation } from "../onec-clients/baseline-replacement-db";
import { createPgPoolOptions } from "../config/pg-ssl";
import { loadPinnedCleanReloadBundle } from "./bundle";
import {
  assertCleanReloadLocksAvailable,
  assertNoConcurrentImports,
  buildCleanReloadPlan,
  releaseCleanReloadLock,
  supersedePendingImportJobs,
  tryAcquireCleanReloadLock,
} from "./preflight";
import { purgeCleanReloadScope } from "./purge";
import { computeTargetDbFingerprint } from "./target-db";
import type { CleanReloadPlan, CleanReloadResult, RunCleanReloadOptions } from "./types";

export type { CleanReloadResult } from "./types";
import { tryAcquireImportLock } from "../onec-clients/import-lock";
import { IMPORT_ADVISORY_LOCK_KEY } from "../onec-clients/constants";

function failure(
  mode: RunCleanReloadOptions["mode"],
  startedAt: number,
  code: string,
  message: string,
  plan?: CleanReloadPlan,
  details?: Record<string, unknown>,
): CleanReloadResult {
  return {
    ok: false,
    mode,
    durationMs: Date.now() - startedAt,
    code,
    message,
    plan,
    details,
  };
}

async function finalizeImageSync(
  client: PoolClient,
  apply: boolean,
): Promise<{ runId: string; status: string } | undefined> {
  const runInsert = await client.query<{ id: string }>(
    `
      INSERT INTO onec_catalog_image_sync_runs (mode, status, source_kind)
      VALUES ($1, 'running', 'local_dir')
      RETURNING id::text AS id
    `,
    [apply ? "apply" : "dry_run"],
  );
  const runId = runInsert.rows[0]!.id;
  const report = await runCatalogImageSync(client, { apply });
  const status =
    report.errors.length &&
    report.filesPrepared === 0 &&
    report.filesRestored === 0 &&
    report.filesSkipped === 0
      ? "failed"
      : report.errors.length || report.stoppedByLimit
        ? "partial"
        : "success";
  await client.query(
    `
      UPDATE onec_catalog_image_sync_runs
      SET finished_at = NOW(),
          status = $2,
          files_seen = $3,
          files_prepared = $4,
          files_failed = $5,
          files_skipped = $6,
          bytes_processed = $7,
          report = $8::jsonb
      WHERE id = $1::uuid
    `,
    [
      runId,
      status,
      report.filesSeen,
      report.filesPrepared + report.filesRestored,
      report.filesFailed,
      report.filesSkipped,
      report.sourceBytesRead + report.previewBytesWritten,
      JSON.stringify(report),
    ],
  );
  if (status === "failed") {
    throw Object.assign(new Error("Catalog image sync failed."), {
      code: "IMAGE_SYNC_FAILED",
      report,
    });
  }
  return { runId, status };
}

export async function runCleanReload(options: RunCleanReloadOptions): Promise<CleanReloadResult> {
  const startedAt = Date.now();
  const mode = options.mode;

  let bundle;
  try {
    bundle = await loadPinnedCleanReloadBundle({
      bundleDir: options.bundleDir,
      holdingLinkPolicy: options.holdingLinkPolicy,
      catalogProfile: options.catalogProfile,
      skipCatalog: options.skipCatalog,
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "BUNDLE_LOAD_FAILED";
    return failure(mode, startedAt, code, error instanceof Error ? error.message : "Bundle load failed.", undefined, {
      issues: (error as { issues?: unknown }).issues,
    });
  }

  const plan = buildCleanReloadPlan(options.databaseUrl, bundle);

  if (mode === "apply") {
    if (!options.expectedBundleFingerprint) {
      return failure(mode, startedAt, "EXPECTED_BUNDLE_FINGERPRINT_REQUIRED", "Apply requires --expected-bundle-fingerprint from dry-run.", plan);
    }
    if (options.expectedBundleFingerprint.toLowerCase() !== plan.bundleFingerprint.toLowerCase()) {
      return failure(mode, startedAt, "BUNDLE_FINGERPRINT_MISMATCH", "Bundle fingerprint does not match dry-run.", plan, {
        expected: options.expectedBundleFingerprint,
        actual: plan.bundleFingerprint,
      });
    }
    if (!options.confirmTargetDb) {
      return failure(mode, startedAt, "CONFIRM_TARGET_DB_REQUIRED", "Apply requires --confirm-target-db from dry-run.", plan);
    }
    if (options.confirmTargetDb.toLowerCase() !== plan.targetDbFingerprint.toLowerCase()) {
      return failure(mode, startedAt, "TARGET_DB_MISMATCH", "Target database fingerprint mismatch; refusing apply.", plan, {
        expected: options.confirmTargetDb,
        actual: plan.targetDbFingerprint,
      });
    }
    const extended = isExtendedApplyPayload(bundle.clientsPayload);
    if (extended) {
      if (!options.confirmExtendedContract || !options.operatorReference?.trim()) {
        return failure(
          mode,
          startedAt,
          "EXTENDED_CONTRACT_CONFIRMATION_REQUIRED",
          "Extended bundle apply requires --confirm-extended-contract and --operator-reference.",
          plan,
        );
      }
    }
  }

  if (mode === "dry_run") {
    try {
      const pool = new Pool(createPgPoolOptions(options.databaseUrl));
      const client = await pool.connect();
      try {
        await assertCleanReloadLocksAvailable(client);
        await assertNoConcurrentImports(client);
      } finally {
        client.release();
        await pool.end();
      }
    } catch (error) {
      return failure(
        mode,
        startedAt,
        (error as { code?: string }).code ?? "PREFLIGHT_FAILED",
        error instanceof Error ? error.message : "Preflight failed.",
        plan,
      );
    }

    return {
      ok: true,
      mode,
      durationMs: Date.now() - startedAt,
      plan,
    };
  }

  const pool = new Pool(createPgPoolOptions(options.databaseUrl));
  let pg: PoolClient | undefined;
  let cleanReloadLockHeld = false;
  let importLockHeld = false;

  try {
    pg = await pool.connect();
    await assertNoConcurrentImports(pg);

    if (!(await tryAcquireCleanReloadLock(pg))) {
      return failure(mode, startedAt, "CLEAN_RELOAD_LOCKED", "Another clean reload is already in progress.", plan);
    }
    cleanReloadLockHeld = true;

    if (!(await tryAcquireImportLock(pg))) {
      return failure(mode, startedAt, "IMPORT_LOCKED", "Client import advisory lock is held.", plan);
    }
    importLockHeld = true;

    await pg.query("BEGIN");
    await supersedePendingImportJobs(pg);
    await purgeCleanReloadScope(pg);

    if (options.confirmExtendedContract && options.operatorReference?.trim()) {
      const confirmation = buildExtendedContractConfirmation({
        clientsSourceSha256: bundle.clientsPayload.sha256,
        payload: bundle.clientsPayload,
        operatorReference: options.operatorReference.trim(),
      });
      await storeExtendedContractConfirmation(pg, {
        clientsSourceSha256: bundle.clientsPayload.sha256,
        verificationFingerprint: confirmation.verificationFingerprint,
        operatorReference: options.operatorReference.trim(),
        confirmationSha256: extendedContractConfirmationSha256(confirmation),
      });
    }

    const importResult = await applyClientsImport({
      databaseUrl: options.databaseUrl,
      payload: bundle.clientsPayload,
      client: pg,
      lockAlreadyHeld: true,
      retainLock: true,
      participatingTransaction: true,
      cleanReloadApply: true,
      originalClientsSourceSha256: bundle.clientsPayload.sha256,
      expectedVerificationFingerprint: bundle.verificationFingerprint,
      holdingLinkValidationPolicy: bundle.holdingLinkPolicy,
      employeeRosterSourceSha256: bundle.employeeRoster.sourceSha256,
      triggerSource: "manual",
    });

    if (!importResult.ok) {
      await pg.query("ROLLBACK");
      return failure(mode, startedAt, importResult.code, importResult.message, plan, {
        clientsImportRunId: importResult.runId,
      });
    }

    await pg.query("COMMIT");

    let catalogImportRunId: string | undefined;
    let catalogVersionId: string | undefined;
    if (!options.skipCatalog && bundle.catalogData) {
      const catalogResult = await applyCatalogImport(options.databaseUrl, bundle.catalogData, {
        triggerSource: "manual",
      });
      if (!catalogResult.ok) {
        return failure(mode, startedAt, catalogResult.code, catalogResult.message, plan, {
          clientsImportRunId: importResult.runId,
          catalogImportRunId: catalogResult.runId,
        });
      }
      catalogImportRunId = catalogResult.runId;
      catalogVersionId = catalogResult.versionId;
    }

    let imageSyncRunId: string | undefined;
    let imageSyncStatus: string | undefined;
    if (!options.skipImageSync) {
      const imageClient = await pool.connect();
      try {
        const imageResult = await finalizeImageSync(imageClient, true);
        imageSyncRunId = imageResult?.runId;
        imageSyncStatus = imageResult?.status;
      } finally {
        imageClient.release();
      }
    }

    return {
      ok: true,
      mode,
      durationMs: Date.now() - startedAt,
      plan,
      apply: {
        clientsImportRunId: importResult.runId!,
        catalogImportRunId,
        catalogVersionId,
        imageSyncRunId,
        imageSyncStatus,
      },
    };
  } catch (error) {
    if (pg) {
      try {
        await pg.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
    }
    return failure(
      mode,
      startedAt,
      (error as { code?: string }).code ?? "CLEAN_RELOAD_FAILED",
      error instanceof Error ? error.message : "Clean reload apply failed.",
      plan,
    );
  } finally {
    if (pg) {
      if (importLockHeld) {
        await pg.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]).catch(() => undefined);
      }
      if (cleanReloadLockHeld) {
        await releaseCleanReloadLock(pg).catch(() => undefined);
      }
      pg.release();
    }
    await pool.end();
  }
}

export { computeTargetDbFingerprint };
