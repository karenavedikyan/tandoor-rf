import type { PoolClient } from "pg";
import { tryAcquireImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import {
  applyMatchedOnlyReturnItems,
  applyMatchedOnlyReturnsAggregate,
  applyMatchedOnlySaleAggregate,
  applyMatchedOnlySaleItems,
  loadApplyRun,
  upsertApplyRun,
} from "./apply-ops";
import { isCommitTransportUncertainty, resolveCommitTransportUncertainty } from "./commit-outcome";
import {
  retireMatchedOnlySessionAfterCommitUncertainty,
  safeDisposeMatchedOnlySession,
} from "./connection-cleanup";
import { loadKnownLegalGuidSet } from "./catalog";
import { planHashFromPlan } from "./plan-build";
import { partitionSalesBundle } from "./partition";
import { captureScopedAfterStateDigest } from "./state-digest";
import {
  assertAfterStateMatchesReceipt,
  assertRestoredBusinessStateMatchesPlanBefore,
  restoreScopedBackup,
} from "./rollback";
import type {
  MatchedOnlyApplyReceiptV1,
  MatchedOnlyBundlePlanV1,
  MatchedOnlyScopedBackupV1,
} from "./types";
import {
  assertLiveTargetMatchesPlan,
  type MatchedOnlyBundleInput,
  validateApprovedPlanAgainstLive,
  validateBackupAgainstPlan,
} from "./guards";
import { assertRosterScopeMatchesApprovedPlan } from "./scope";
import type { MatchedOnlyRunResult } from "./types";
import {
  assertExecutionCapability,
  type MatchedOnlyExecutionCapability,
} from "./execution-capability";
import { verifyMatchedOnlyPersistedOutcome } from "./apply-persist-verify";
import { assertMatchedOnlySchemaReady } from "./production/schema-readiness";
import {
  assertProductionApplyContextUnderLock,
  type ProductionApplyWriteBinding,
} from "./production/apply-write-guard";

async function assertApplySchemaReady(
  client: PoolClient,
  capability: MatchedOnlyExecutionCapability,
): Promise<void> {
  if (capability.channel === "production") {
    const schema = await assertMatchedOnlySchemaReady(client);
    if (!schema.ok) {
      throw new Error(schema.code);
    }
    return;
  }
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_import_quarantine_rows LIMIT 0`);
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_import_month_stats LIMIT 0`);
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_bundle_apply_runs LIMIT 0`);
}

async function tryResolveAlreadyAppliedNoOp(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
): Promise<MatchedOnlyApplyReceiptV1 | null> {
  const existing = await loadApplyRun(client, approvedPlanHash);
  if (existing?.status !== "applied" || !existing.after_state_sha256) {
    return null;
  }
  const current = await captureScopedAfterStateDigest(client, plan.scope.saleMonthsIso);
  if (current !== existing.after_state_sha256) {
    throw new Error("APPLY_DRIFT");
  }
  const receipt = existing.receipt_json as MatchedOnlyApplyReceiptV1;
  return { ...receipt, status: "no_op_already_applied" };
}

/** Shared SQL apply path; requires channel capability from test or production facade. */
export async function executeMatchedOnlyApply(
  capability: MatchedOnlyExecutionCapability,
  databaseUrl: string,
  rosters: MatchedOnlyBundleInput,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  backup: MatchedOnlyScopedBackupV1,
  expectedBackupSha256: string,
  testHooks?: { failBeforeCommit?: boolean },
  productionBinding?: ProductionApplyWriteBinding,
): Promise<MatchedOnlyRunResult> {
  assertExecutionCapability(capability);
  if (capability.channel === "production" && !productionBinding) {
    return {
      ok: false,
      mode: "apply",
      code: "PRODUCTION_BINDING_REQUIRED",
      message: "Production apply requires verified execution binding.",
    };
  }
  const computedHash = planHashFromPlan(plan);
  if (approvedPlanHash !== computedHash) {
    return { ok: false, mode: "apply", code: "PLAN_HASH_MISMATCH", message: "Approved plan hash mismatch." };
  }
  try {
    await assertLiveTargetMatchesPlan(databaseUrl, plan);
  } catch (error) {
    return {
      ok: false,
      mode: "apply",
      code: error instanceof Error ? error.message : "TARGET_IDENTITY_MISMATCH",
      message: error instanceof Error ? error.message : "Target identity mismatch.",
    };
  }
  const backupFailure = validateBackupAgainstPlan(backup, plan, expectedBackupSha256);
  if (backupFailure) {
    return { ok: false, mode: "apply", code: backupFailure.code, message: backupFailure.message };
  }
  try {
    assertRosterScopeMatchesApprovedPlan(plan, rosters);
  } catch (error) {
    return {
      ok: false,
      mode: "apply",
      code: error instanceof Error ? error.message : "PLAN_SCOPE_MISMATCH",
      message: error instanceof Error ? error.message : "Plan scope mismatch.",
    };
  }

  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  let lockHeld = false;
  let transactionOpen = false;
  let sessionDisposed = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await assertApplySchemaReady(client, capability);
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { ok: false, mode: "apply", code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    lockHeld = true;

    if (capability.channel === "production" && productionBinding) {
      await assertProductionApplyContextUnderLock(
        client,
        productionBinding,
        plan,
        backup,
        approvedPlanHash,
      );
    }

    const existing = await loadApplyRun(client, approvedPlanHash);
    if (existing?.status === "commit_uncertain") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return {
        ok: false,
        mode: "apply",
        code: "COMMIT_UNCERTAIN",
        message: "Prior commit outcome uncertain; reconcile manually before retry.",
      };
    }

    const noOpReceipt = await tryResolveAlreadyAppliedNoOp(client, plan, approvedPlanHash);
    if (noOpReceipt) {
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        ok: true,
        mode: "apply",
        plan,
        planHash: approvedPlanHash,
        receipt: noOpReceipt,
      };
    }

    await validateApprovedPlanAgainstLive(client, plan, rosters);

    const known = await loadKnownLegalGuidSet(client);
    const partition = partitionSalesBundle({ ...rosters, known });

    await client.query(`DELETE FROM onec_v3_legal_sales_import_quarantine_rows WHERE plan_hash = $1`, [
      approvedPlanHash,
    ]);

    const insertedSaleAgg = await applyMatchedOnlySaleAggregate(
      client,
      rosters.saleAggregate,
      partition.saleAggregate,
      approvedPlanHash,
    );
    const insertedSaleItems = await applyMatchedOnlySaleItems(
      client,
      rosters.saleItems,
      partition.saleItems,
      approvedPlanHash,
    );
    const insertedRetAgg = await applyMatchedOnlyReturnsAggregate(
      client,
      rosters.returnsAggregate,
      partition.returnsAggregate,
      approvedPlanHash,
    );
    const insertedRetItems = await applyMatchedOnlyReturnItems(
      client,
      rosters.returnItems,
      partition.returnItems,
      approvedPlanHash,
    );

    if (testHooks?.failBeforeCommit) {
      throw new Error("TEST_FAIL_BEFORE_COMMIT");
    }

    const persistCheck = await verifyMatchedOnlyPersistedOutcome(
      client,
      plan,
      partition,
      rosters,
      {
        saleAggregate: insertedSaleAgg,
        saleItems: insertedSaleItems,
        returnsAggregate: insertedRetAgg,
        returnItems: insertedRetItems,
      },
    );
    if (!persistCheck.ok) {
      throw new Error(persistCheck.code);
    }

    const matchedTotal =
      partition.saleAggregate.counts.matched +
      partition.saleItems.counts.matched +
      partition.returnsAggregate.counts.matched +
      partition.returnItems.counts.matched;
    const fullTotal =
      partition.saleAggregate.counts.full +
      partition.saleItems.counts.full +
      partition.returnsAggregate.counts.full +
      partition.returnItems.counts.full;
    const excludedTotal =
      partition.saleAggregate.counts.excluded +
      partition.saleItems.counts.excluded +
      partition.returnsAggregate.counts.excluded +
      partition.returnItems.counts.excluded;

    const afterStateSha256 = await captureScopedAfterStateDigest(client, plan.scope.saleMonthsIso);
    const receipt: MatchedOnlyApplyReceiptV1 = {
      v: 1,
      planHash: approvedPlanHash,
      targetDbFingerprint: plan.identity.targetDbFingerprint,
      beforeStateSha256: plan.beforeStateSha256,
      afterStateSha256,
      backupSha256: expectedBackupSha256,
      status: "applied",
      appliedAt: new Date().toISOString(),
      inserted: {
        full: fullTotal,
        matched: matchedTotal,
        excluded: excludedTotal,
        saleAggregate: insertedSaleAgg,
        saleItems: insertedSaleItems,
        returnsAggregate: insertedRetAgg,
        returnItems: insertedRetItems,
      },
      quarantined: {
        saleAggregate: plan.counts.saleAggregate,
        saleItems: plan.counts.saleItems,
        returnsAggregate: plan.counts.returnsAggregate,
        returnItems: plan.counts.returnItems,
      },
      ...(productionBinding
        ? {
            productionBinding: {
              manifestContentHash: productionBinding.manifestContentHash,
              codeArtifactLabel: productionBinding.codeArtifactLabel,
              returnsMatchedIncome: productionBinding.executionBudget.returnsMatchedIncome,
            },
          }
        : {}),
    };
    await upsertApplyRun(client, {
      planHash: approvedPlanHash,
      status: "applied",
      plan,
      backupSha256: expectedBackupSha256,
      afterStateSha256,
      receipt,
    });

    try {
      await client.query("COMMIT");
      transactionOpen = false;
      return { ok: true, mode: "apply", plan, planHash: approvedPlanHash, receipt };
    } catch (commitError) {
      transactionOpen = false;
      lockHeld = false;
      if (isCommitTransportUncertainty(commitError)) {
        await retireMatchedOnlySessionAfterCommitUncertainty(client, pool, false);
        sessionDisposed = true;
        const resolution = await resolveCommitTransportUncertainty(
          databaseUrl,
          plan,
          approvedPlanHash,
          receipt,
          expectedBackupSha256,
        );
        if (resolution.kind === "reconciled") {
          return {
            ok: true,
            mode: "apply",
            plan,
            planHash: approvedPlanHash,
            receipt: resolution.receipt,
          };
        }
        return {
          ok: false,
          mode: "apply",
          code: "COMMIT_UNCERTAIN",
          message: "Commit outcome unknown; reconcile read-only before retry.",
        };
      }
      throw commitError;
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "APPLY_FAILED";
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }
    return {
      ok: false,
      mode: "apply",
      code,
      message: error instanceof Error ? error.message : "Apply failed.",
    };
  } finally {
    if (!sessionDisposed) {
      await safeDisposeMatchedOnlySession(client, pool, lockHeld);
    }
  }
}

/** Shared SQL rollback path; requires channel capability from test or production facade. */
export async function executeMatchedOnlyRollback(
  capability: MatchedOnlyExecutionCapability,
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  backup: MatchedOnlyScopedBackupV1,
  expectedBackupSha256: string,
): Promise<MatchedOnlyRunResult> {
  assertExecutionCapability(capability);
  if (planHashFromPlan(plan) !== approvedPlanHash) {
    return { ok: false, mode: "rollback", code: "PLAN_HASH_MISMATCH", message: "Plan hash mismatch." };
  }
  try {
    await assertLiveTargetMatchesPlan(databaseUrl, plan);
  } catch (error) {
    return {
      ok: false,
      mode: "rollback",
      code: error instanceof Error ? error.message : "TARGET_IDENTITY_MISMATCH",
      message: error instanceof Error ? error.message : "Target identity mismatch.",
    };
  }
  const backupFailure = validateBackupAgainstPlan(backup, plan, expectedBackupSha256);
  if (backupFailure) {
    return { ok: false, mode: "rollback", code: backupFailure.code, message: backupFailure.message };
  }

  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  let lockHeld = false;
  let transactionOpen = false;
  let sessionDisposed = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await assertApplySchemaReady(client, capability);
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { ok: false, mode: "rollback", code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    lockHeld = true;

    const run = await loadApplyRun(client, approvedPlanHash);
    if (!run || run.status !== "applied" || !run.after_state_sha256) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { ok: false, mode: "rollback", code: "ROLLBACK_NOT_APPLIED", message: "Plan not in applied state." };
    }
    if (run.backup_sha256 && run.backup_sha256 !== expectedBackupSha256) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { ok: false, mode: "rollback", code: "BACKUP_SHA_MISMATCH", message: "Backup SHA mismatch." };
    }
    await assertAfterStateMatchesReceipt(client, backup, run.after_state_sha256);
    await restoreScopedBackup(client, backup);
    await assertRestoredBusinessStateMatchesPlanBefore(client, backup, plan.beforeStateSha256);
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_bundle_apply_runs (
          plan_hash, status, target_db_fingerprint, catalog_fingerprint,
          backup_sha256, before_state_sha256, after_state_sha256, receipt_json, rolled_back_at
        )
        VALUES ($1, 'rolled_back', $2, $3, $4, $5, $6, $7::jsonb, NOW())
        ON CONFLICT (plan_hash) DO UPDATE SET
          status = 'rolled_back',
          rolled_back_at = NOW()
      `,
      [
        approvedPlanHash,
        plan.identity.targetDbFingerprint,
        plan.catalog.fingerprint,
        expectedBackupSha256,
        plan.beforeStateSha256,
        run.after_state_sha256,
        JSON.stringify({ v: 1, planHash: approvedPlanHash, status: "rolled_back" }),
      ],
    );
    try {
      await client.query("COMMIT");
      transactionOpen = false;
      lockHeld = false;
      return { ok: true, mode: "rollback", plan, planHash: approvedPlanHash };
    } catch (commitError) {
      transactionOpen = false;
      lockHeld = false;
      if (isCommitTransportUncertainty(commitError)) {
        await retireMatchedOnlySessionAfterCommitUncertainty(client, pool, false);
        sessionDisposed = true;
        return {
          ok: false,
          mode: "rollback",
          code: "COMMIT_UNCERTAIN",
          message: "Rollback commit outcome unknown; reconcile read-only before retry.",
        };
      }
      throw commitError;
    }
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    return {
      ok: false,
      mode: "rollback",
      code: error instanceof Error ? error.message : "ROLLBACK_FAILED",
      message: error instanceof Error ? error.message : "Rollback failed.",
    };
  } finally {
    if (!sessionDisposed) {
      await safeDisposeMatchedOnlySession(client, pool, lockHeld);
    }
  }
}
