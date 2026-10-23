import type { PoolClient } from "pg";
import { resolveTargetDbIdentityFromUrl } from "../../onec-exchange-v3/target-db-identity";
import { tryAcquireImportLock, releaseImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import {
  applyMatchedOnlyReturnItems,
  applyMatchedOnlyReturnsAggregate,
  applyMatchedOnlySaleAggregate,
  applyMatchedOnlySaleItems,
  loadApplyRun,
  upsertApplyRun,
} from "./apply-ops";
import { backupSha256, readBackupFile } from "./backup";
import { loadKnownLegalGuidSet } from "./catalog";
import { buildMatchedOnlyBundlePlan, planHashFromPlan } from "./plan-build";
import { partitionSalesBundle } from "./partition";
import { captureScopedBackup } from "./scoped-backup-capture";
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
  isCommitTransportUncertainty,
  markCommitUncertain,
  reconcileAppliedPlanAfterCommitUncertainty,
} from "./commit-outcome";
import {
  assertLiveTargetMatchesPlan,
  type MatchedOnlyBundleInput,
  validateApprovedPlanAgainstLive,
  validateBackupAgainstPlan,
} from "./guards";
import { assertRosterScopeMatchesApprovedPlan } from "./scope";

export type { MatchedOnlyBundleInput } from "./guards";

export type MatchedOnlyMode = "plan" | "validate-backup" | "apply" | "rollback";

export type MatchedOnlyRunResult =
  | {
      ok: true;
      mode: MatchedOnlyMode;
      plan?: MatchedOnlyBundlePlanV1;
      planHash?: string;
      receipt?: MatchedOnlyApplyReceiptV1;
      backup?: MatchedOnlyScopedBackupV1;
    }
  | { ok: false; mode: MatchedOnlyMode; code: string; message: string };

async function assertSidecarSchema(client: PoolClient): Promise<void> {
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

export async function runMatchedOnlyBundlePlan(
  databaseUrl: string,
  rosters: MatchedOnlyBundleInput,
): Promise<MatchedOnlyRunResult> {
  const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    const built = await buildMatchedOnlyBundlePlan(client, {
      ...rosters,
      targetDbFingerprint: identity.fingerprint,
    });
    return { ok: true, mode: "plan", plan: built.plan, planHash: built.planHash };
  } catch (error) {
    return {
      ok: false,
      mode: "plan",
      code: error instanceof Error ? error.message : "PLAN_FAILED",
      message: error instanceof Error ? error.message : "Plan failed.",
    };
  } finally {
    client.release();
    await pool.end();
  }
}

export async function runMatchedOnlyValidateBackup(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
  backupPath: string,
  expectedBackupSha256: string,
): Promise<MatchedOnlyRunResult> {
  try {
    await assertLiveTargetMatchesPlan(databaseUrl, plan);
  } catch (error) {
    return {
      ok: false,
      mode: "validate-backup",
      code: error instanceof Error ? error.message : "TARGET_IDENTITY_MISMATCH",
      message: error instanceof Error ? error.message : "Target identity mismatch.",
    };
  }
  const backup = await readBackupFile(backupPath);
  const failure = validateBackupAgainstPlan(backup, plan, expectedBackupSha256);
  if (failure) {
    return { ok: false, mode: "validate-backup", code: failure.code, message: failure.message };
  }
  return { ok: true, mode: "validate-backup", plan, planHash: planHashFromPlan(plan), backup };
}

export async function runMatchedOnlyApply(
  databaseUrl: string,
  rosters: MatchedOnlyBundleInput,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  backup: MatchedOnlyScopedBackupV1,
  expectedBackupSha256: string,
  testHooks?: { failBeforeCommit?: boolean },
): Promise<MatchedOnlyRunResult> {
  if (!process.env.TEST_DATABASE_URL || databaseUrl !== process.env.TEST_DATABASE_URL) {
    return {
      ok: false,
      mode: "apply",
      code: "TEST_DATABASE_REQUIRED",
      message: "Matched-only apply requires TEST_DATABASE_URL and must not target production DATABASE_URL.",
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
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await assertSidecarSchema(client);
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { ok: false, mode: "apply", code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    lockHeld = true;

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
        full: 0,
        matched: 0,
        excluded: 0,
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
      if (isCommitTransportUncertainty(commitError)) {
        const reconciled = await reconcileAppliedPlanAfterCommitUncertainty(
          databaseUrl,
          plan,
          approvedPlanHash,
          receipt,
        );
        if (reconciled) {
          return { ok: true, mode: "apply", plan, planHash: approvedPlanHash, receipt: reconciled };
        }
        const markPool = createImportPool(databaseUrl);
        const markClient = await markPool.connect();
        try {
          await markClient.query("BEGIN");
          await markCommitUncertain(markClient, plan, approvedPlanHash, expectedBackupSha256);
          await markClient.query("COMMIT");
        } finally {
          markClient.release();
          await markPool.end();
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
    if (lockHeld) {
      await releaseImportLock(client);
    }
    client.release();
    await pool.end();
  }
}

export async function captureMatchedOnlyBackupForPlan(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
): Promise<MatchedOnlyScopedBackupV1> {
  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    return await captureScopedBackup(client, plan);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function runMatchedOnlyRollback(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
  approvedPlanHash: string,
  backup: MatchedOnlyScopedBackupV1,
  expectedBackupSha256: string,
): Promise<MatchedOnlyRunResult> {
  if (!process.env.TEST_DATABASE_URL || databaseUrl !== process.env.TEST_DATABASE_URL) {
    return {
      ok: false,
      mode: "rollback",
      code: "TEST_DATABASE_REQUIRED",
      message: "Rollback requires TEST_DATABASE_URL.",
    };
  }
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
  try {
    await client.query("BEGIN");
    transactionOpen = true;
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
    await client.query("COMMIT");
    transactionOpen = false;
    return { ok: true, mode: "rollback", plan, planHash: approvedPlanHash };
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
    if (lockHeld) {
      await releaseImportLock(client);
    }
    client.release();
    await pool.end();
  }
}
