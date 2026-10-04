import { Pool, type PoolClient } from "pg";
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
  assertCleanReloadConcurrentImportsClear,
  buildCleanReloadPlan,
  readConcurrentImportState,
  releaseCleanReloadLock,
  runCleanReloadPreflight,
  tryAcquireCleanReloadLock,
} from "./preflight";
import { assertCleanReloadSchemaReady } from "./schema-preflight";
import { verifyCleanReloadOutletRegistry } from "./outlet-registry-verify";
import { purgeCleanReloadScope } from "./purge";
import { replaceWholesaleEmployeeRoster, revokeEmployeeLinksOutsideRoster } from "./roster-apply";
import { computeTargetDbFingerprint } from "./target-db";
import type { CleanReloadPlan, CleanReloadResult, RunCleanReloadOptions } from "./types";

export type { CleanReloadResult } from "./types";
import { tryAcquireImportLock } from "../onec-clients/import-lock";
import { IMPORT_ADVISORY_LOCK_KEY } from "../onec-clients/constants";
import { inspectCleanReloadSchema } from "./schema-preflight";

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

function preflightBlockerFailure(
  mode: RunCleanReloadOptions["mode"],
  startedAt: number,
  plan: CleanReloadPlan,
): CleanReloadResult | null {
  if (plan.blockers.length === 0) {
    return null;
  }

  const schemaBlocker = plan.blockers.find((item) => item.startsWith("MIGRATIONS_NOT_READY:"));
  if (schemaBlocker) {
    return failure(
      mode,
      startedAt,
      "MIGRATIONS_NOT_READY",
      "Database schema is not ready for clean reload (apply migration 032 and earlier client migrations).",
      plan,
      { blockers: plan.blockers },
    );
  }

  const code = plan.blockers.includes("PENDING_IMPORT_JOBS")
    ? "PENDING_IMPORT_JOBS"
    : plan.blockers.includes("CONCURRENT_CLIENT_IMPORT")
      ? "CONCURRENT_CLIENT_IMPORT"
      : "PREFLIGHT_BLOCKED";

  return failure(
    mode,
    startedAt,
    code,
    mode === "dry_run"
      ? "Clean reload preflight blockers must be resolved before dry-run."
      : "Clean reload preflight blockers must be resolved before apply.",
    plan,
    { blockers: plan.blockers },
  );
}

async function buildPlanWithLivePreflight(
  databaseUrl: string,
  bundle: Awaited<ReturnType<typeof loadPinnedCleanReloadBundle>>,
): Promise<CleanReloadPlan> {
  const pool = new Pool(createPgPoolOptions(databaseUrl));
  const client = await pool.connect();
  try {
    const schema = await inspectCleanReloadSchema(client);
    const concurrent = await readConcurrentImportState(client);
    return buildCleanReloadPlan(databaseUrl, bundle, schema, concurrent);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function runCleanReload(options: RunCleanReloadOptions): Promise<CleanReloadResult> {
  const startedAt = Date.now();
  const mode = options.mode;

  let bundle;
  try {
    bundle = await loadPinnedCleanReloadBundle({
      bundleDir: options.bundleDir,
      holdingLinkPolicy: options.holdingLinkPolicy,
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "BUNDLE_LOAD_FAILED";
    return failure(mode, startedAt, code, error instanceof Error ? error.message : "Bundle load failed.", undefined, {
      issues: (error as { issues?: unknown }).issues,
    });
  }

  let plan: CleanReloadPlan;
  try {
    plan = await buildPlanWithLivePreflight(options.databaseUrl, bundle);
  } catch (error) {
    return failure(
      mode,
      startedAt,
      (error as { code?: string }).code ?? "PREFLIGHT_FAILED",
      error instanceof Error ? error.message : "Preflight failed.",
    );
  }

  const blockerFailure = preflightBlockerFailure(mode, startedAt, plan);
  if (blockerFailure) {
    return blockerFailure;
  }

  const rosterGuids = Array.from(bundle.employeeRoster.wholesaleGuids);

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
        await runCleanReloadPreflight(client);
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
  let commitAttempted = false;
  let commitConfirmed = false;

  try {
    pg = await pool.connect();

    if (!(await tryAcquireCleanReloadLock(pg))) {
      return failure(mode, startedAt, "CLEAN_RELOAD_LOCKED", "Another clean reload is already in progress.", plan);
    }
    cleanReloadLockHeld = true;

    if (!(await tryAcquireImportLock(pg))) {
      return failure(mode, startedAt, "IMPORT_LOCKED", "Client import advisory lock is held.", plan);
    }
    importLockHeld = true;

    await assertCleanReloadSchemaReady(pg);
    await assertCleanReloadConcurrentImportsClear(pg);
    // Re-check immediately before BEGIN to close the claim race under held advisory locks.
    await assertCleanReloadConcurrentImportsClear(pg);

    await pg.query("BEGIN");
    await purgeCleanReloadScope(pg);
    await options.testHooks?.afterPurge?.(pg);

    const revokedEmployeeLinks = await revokeEmployeeLinksOutsideRoster(pg, rosterGuids);

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

    await options.testHooks?.afterClientsImport?.(pg);
    await options.testHooks?.beforeRosterReplace?.(pg);

    const rosterEmployeeCount = await replaceWholesaleEmployeeRoster(pg, {
      sourceSha256: bundle.employeeRoster.sourceSha256,
      records: bundle.employeeRoster.records,
    });

    const outletRegistry = await verifyCleanReloadOutletRegistry(pg, bundle.expectedOutlets);
    if (!outletRegistry.ok) {
      await pg.query("ROLLBACK");
      return failure(mode, startedAt, outletRegistry.code, outletRegistry.message, plan, outletRegistry.details);
    }

    commitAttempted = true;
    await pg.query("COMMIT");
    commitConfirmed = true;

    return {
      ok: true,
      mode,
      durationMs: Date.now() - startedAt,
      plan,
      apply: {
        clientsImportRunId: importResult.runId!,
        rosterEmployeeCount,
        revokedEmployeeLinks,
        outletGuidsLoaded: outletRegistry.outletGuidsLoaded,
      },
    };
  } catch (error) {
    if (pg) {
      try {
        if (commitAttempted && !commitConfirmed) {
          await pg.query("ROLLBACK");
        } else if (!commitAttempted) {
          await pg.query("ROLLBACK");
        }
      } catch {
        // ignore rollback failure
      }
    }

    if (commitAttempted && !commitConfirmed) {
      return failure(
        mode,
        startedAt,
        "COMMIT_UNCERTAIN",
        "Clean reload commit outcome is unknown; inspect database state before retrying this destructive procedure.",
        plan,
      );
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
