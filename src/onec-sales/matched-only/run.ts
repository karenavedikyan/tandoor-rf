import type { PoolClient } from "pg";
import { resolveTargetDbIdentityFromUrl } from "../../onec-exchange-v3/target-db-identity";
import { tryAcquireImportLock, releaseImportLock } from "../../onec-clients/import-lock";
import { createImportPool } from "../../onec-clients/apply";
import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "../types";
import {
  applyMatchedOnlyReturnItems,
  applyMatchedOnlyReturnsAggregate,
  applyMatchedOnlySaleAggregate,
  applyMatchedOnlySaleItems,
  loadApplyRun,
  upsertApplyRun,
} from "./apply-ops";
import { backupSha256, readBackupFile, validateBackupAgainstPlan } from "./backup";
import { computeCatalogFingerprint, loadKnownLegalGuidSet } from "./catalog";
import { analyzeSalesBundle, isBundleParityOk } from "../bundle-analyze";
import { buildMatchedOnlyBundlePlan, planHashFromPlan } from "./plan-build";
import { partitionSalesBundle } from "./partition";
import { captureScopedBackup } from "./scoped-backup-capture";
import { captureScopedAfterStateDigest, captureScopedBeforeState } from "./state-digest";
import { assertAfterStateMatchesReceipt, restoreScopedBackup } from "./rollback";
import type {
  MatchedOnlyApplyReceiptV1,
  MatchedOnlyBundlePlanV1,
  MatchedOnlyScopedBackupV1,
} from "./types";

export type MatchedOnlyMode = "plan" | "validate-backup" | "apply" | "rollback";

export type MatchedOnlyRunResult =
  | { ok: true; mode: MatchedOnlyMode; plan?: MatchedOnlyBundlePlanV1; planHash?: string; receipt?: MatchedOnlyApplyReceiptV1; backup?: MatchedOnlyScopedBackupV1 }
  | { ok: false; mode: MatchedOnlyMode; code: string; message: string };

export type MatchedOnlyBundleInput = {
  saleAggregate: LegalSalesRoster;
  saleItems: LegalSaleItemsRoster;
  returnsAggregate: LegalReturnsRoster;
  returnItems: LegalReturnItemsRoster;
};

async function assertSidecarSchema(client: PoolClient): Promise<void> {
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_import_quarantine_rows LIMIT 0`);
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_import_month_stats LIMIT 0`);
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_bundle_apply_runs LIMIT 0`);
}

async function validatePlanFreshness(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  rosters: MatchedOnlyBundleInput,
): Promise<void> {
  const hashes = plan.sourceHashes;
  if (hashes.saleAggregate !== rosters.saleAggregate.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }
  if (hashes.saleItems !== rosters.saleItems.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }
  if (hashes.returnsAggregate !== rosters.returnsAggregate.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }
  if (hashes.returnItems !== rosters.returnItems.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }
  const known = await loadKnownLegalGuidSet(client);
  const catalogFingerprint = computeCatalogFingerprint(known);
  if (catalogFingerprint !== plan.catalog.fingerprint) {
    throw new Error("PLAN_CATALOG_DRIFT");
  }
  const before = await captureScopedBeforeState(client, plan.scope.saleMonthsIso);
  if (before.businessDigest !== plan.beforeStateSha256) {
    throw new Error("PLAN_BEFORE_STATE_DRIFT");
  }
  const report = analyzeSalesBundle({
    salesAggregate: rosters.saleAggregate,
    salesItems: rosters.saleItems,
    returnsAggregate: rosters.returnsAggregate,
    returnsItems: rosters.returnItems,
    knownCatalogLegalGuids: known,
  });
  if (!isBundleParityOk(report)) {
    throw new Error("BUNDLE_PARITY_FAILED");
  }
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
  expectedBackupSha256?: string,
): Promise<MatchedOnlyRunResult> {
  const backup = await readBackupFile(backupPath);
  const failure = validateBackupAgainstPlan(backup, plan, expectedBackupSha256);
  if (failure) {
    return { ok: false, mode: "validate-backup", code: failure.code, message: failure.message };
  }
  const sha = backupSha256(backup);
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
  const backupFailure = validateBackupAgainstPlan(backup, plan, expectedBackupSha256);
  if (backupFailure) {
    return { ok: false, mode: "apply", code: backupFailure.code, message: backupFailure.message };
  }

  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertSidecarSchema(client);
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      return { ok: false, mode: "apply", code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    try {
      await validatePlanFreshness(client, plan, rosters);

      const existing = await loadApplyRun(client, approvedPlanHash);
      if (existing?.status === "applied" && existing.after_state_sha256) {
        const current = await captureScopedAfterStateDigest(client, plan.scope.saleMonthsIso);
        if (current === existing.after_state_sha256) {
          await client.query("COMMIT");
          return {
            ok: true,
            mode: "apply",
            plan,
            planHash: approvedPlanHash,
            receipt: existing.receipt_json as MatchedOnlyApplyReceiptV1,
          };
        }
        await client.query("ROLLBACK");
        return {
          ok: false,
          mode: "apply",
          code: "APPLY_DRIFT",
          message: "Plan already applied but database drifted.",
        };
      }
      if (existing?.status === "commit_uncertain") {
        await client.query("ROLLBACK");
        return {
          ok: false,
          mode: "apply",
          code: "COMMIT_UNCERTAIN",
          message: "Prior commit outcome uncertain; reconcile manually before retry.",
        };
      }

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
      await client.query("COMMIT");
      return { ok: true, mode: "apply", plan, planHash: approvedPlanHash, receipt };
    } finally {
      await releaseImportLock(client);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return {
      ok: false,
      mode: "apply",
      code: error instanceof Error ? error.message : "APPLY_FAILED",
      message: error instanceof Error ? error.message : "Apply failed.",
    };
  } finally {
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
  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      return { ok: false, mode: "rollback", code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    try {
      const run = await loadApplyRun(client, approvedPlanHash);
      if (!run || run.status !== "applied" || !run.after_state_sha256) {
        await client.query("ROLLBACK");
        return { ok: false, mode: "rollback", code: "ROLLBACK_NOT_APPLIED", message: "Plan not in applied state." };
      }
      await assertAfterStateMatchesReceipt(client, backup, run.after_state_sha256);
      await restoreScopedBackup(client, backup);
      await client.query(
        `
          UPDATE onec_v3_legal_sales_bundle_apply_runs
          SET status = 'rolled_back', rolled_back_at = NOW()
          WHERE plan_hash = $1
        `,
        [approvedPlanHash],
      );
      await client.query("COMMIT");
      return { ok: true, mode: "rollback", plan, planHash: approvedPlanHash };
    } finally {
      await releaseImportLock(client);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return {
      ok: false,
      mode: "rollback",
      code: error instanceof Error ? error.message : "ROLLBACK_FAILED",
      message: error instanceof Error ? error.message : "Rollback failed.",
    };
  } finally {
    client.release();
    await pool.end();
  }
}
