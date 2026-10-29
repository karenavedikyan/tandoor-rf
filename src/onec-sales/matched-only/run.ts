import type { PoolClient } from "pg";
import { resolveTargetDbIdentityFromUrl } from "../../onec-exchange-v3/target-db-identity";
import { createImportPool } from "../../onec-clients/apply";
import { executeMatchedOnlyApply, executeMatchedOnlyRollback } from "./apply-pipeline";
import { issueTestExecutionCapability } from "./execution-capability";
import { readBackupFile } from "./backup";
import { buildMatchedOnlyBundlePlan, planHashFromPlan } from "./plan-build";
import { captureScopedBackup } from "./scoped-backup-capture";
import type {
  MatchedOnlyBundlePlanV1,
  MatchedOnlyMode,
  MatchedOnlyRunResult,
  MatchedOnlyScopedBackupV1,
} from "./types";
import {
  assertLiveTargetMatchesPlan,
  type MatchedOnlyBundleInput,
  validateBackupAgainstPlan,
} from "./guards";

export type { MatchedOnlyBundleInput } from "./guards";
export type { MatchedOnlyMode, MatchedOnlyRunResult };

function assertTestDatabaseChannel(databaseUrl: string, mode: MatchedOnlyMode): MatchedOnlyRunResult | null {
  if (!process.env.TEST_DATABASE_URL || databaseUrl !== process.env.TEST_DATABASE_URL) {
    return {
      ok: false,
      mode,
      code: "TEST_DATABASE_REQUIRED",
      message:
        mode === "rollback"
          ? "Rollback requires TEST_DATABASE_URL."
          : "Matched-only apply requires TEST_DATABASE_URL and must not target production DATABASE_URL.",
    };
  }
  return null;
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
  const channelFailure = assertTestDatabaseChannel(databaseUrl, "apply");
  if (channelFailure) {
    return channelFailure;
  }
  return executeMatchedOnlyApply(
    issueTestExecutionCapability(databaseUrl),
    databaseUrl,
    rosters,
    plan,
    approvedPlanHash,
    backup,
    expectedBackupSha256,
    testHooks,
  );
}

export async function captureMatchedOnlyBackupForPlan(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
): Promise<MatchedOnlyScopedBackupV1> {
  const channelFailure = assertTestDatabaseChannel(databaseUrl, "validate-backup");
  if (channelFailure) {
    throw new Error(channelFailure.ok === false ? channelFailure.message : "TEST_DATABASE_REQUIRED");
  }
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
  const channelFailure = assertTestDatabaseChannel(databaseUrl, "rollback");
  if (channelFailure) {
    return channelFailure;
  }
  return executeMatchedOnlyRollback(
    issueTestExecutionCapability(databaseUrl),
    databaseUrl,
    plan,
    approvedPlanHash,
    backup,
    expectedBackupSha256,
  );
}
