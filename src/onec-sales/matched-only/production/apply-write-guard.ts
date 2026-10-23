import type { PoolClient } from "pg";
import { captureScopedAfterStateDigest, captureScopedBeforeState } from "../state-digest";
import type { MatchedOnlyBundlePlanV1, MatchedOnlyScopedBackupV1 } from "../types";
import { validateBackupAgainstPlan } from "../guards";
import { planHashFromPlan } from "../plan-build";
import type { ExecutionManifestBudgetV2 } from "./manifest-types";
import { validateManifestBudgetAgainstPlan } from "./manifest-budget";
import { assertMatchedOnlySchemaReady } from "./schema-readiness";

export type ProductionApplyWriteBinding = {
  manifestContentHash: string;
  codeArtifactLabel: string;
  expectedExecutableArtifactSha256: string;
  approvalValidUntil: string;
  executionBudget: ExecutionManifestBudgetV2;
  expectedBackupSha256: string;
};

export type ProductionRollbackWriteBinding = {
  manifestContentHash: string;
  codeArtifactLabel: string;
  expectedExecutableArtifactSha256: string;
  approvalValidUntil: string;
  expectedBackupSha256: string;
  originalApplyPlanHash: string;
  expectedLiveAfterStateSha256: string;
  rollbackScopeHash: string;
};

async function assertCommonProductionBinding(
  binding: { manifestContentHash: string; codeArtifactLabel: string; expectedExecutableArtifactSha256: string; approvalValidUntil: string },
): Promise<void> {
  const expires = Date.parse(binding.approvalValidUntil);
  if (Number.isNaN(expires) || Date.now() > expires) {
    throw new Error("MANIFEST_APPROVAL_EXPIRED");
  }
  if (
    !binding.manifestContentHash?.trim() ||
    !binding.codeArtifactLabel?.trim() ||
    !binding.expectedExecutableArtifactSha256?.trim()
  ) {
    throw new Error("PRODUCTION_BINDING_INCOMPLETE");
  }
}

export async function assertProductionApplyContextUnderLock(
  client: PoolClient,
  binding: ProductionApplyWriteBinding,
  plan: MatchedOnlyBundlePlanV1,
  backup: MatchedOnlyScopedBackupV1,
  approvedPlanHash: string,
  phase: "fresh_apply" | "already_applied",
  expectedLiveAfterStateSha256?: string,
): Promise<void> {
  const schema = await assertMatchedOnlySchemaReady(client);
  if (!schema.ok) {
    throw new Error(schema.code);
  }
  if (planHashFromPlan(plan) !== approvedPlanHash) {
    throw new Error("PLAN_HASH_MISMATCH");
  }
  const budgetCheck = validateManifestBudgetAgainstPlan(plan, binding.executionBudget);
  if (!budgetCheck.ok) {
    throw new Error(budgetCheck.code);
  }
  const backupFailure = validateBackupAgainstPlan(backup, plan, binding.expectedBackupSha256);
  if (backupFailure) {
    throw new Error(backupFailure.code);
  }
  await assertCommonProductionBinding(binding);
  if (phase === "fresh_apply") {
    const liveBefore = await captureScopedBeforeState(client, plan.scope.saleMonthsIso);
    if (liveBefore.businessDigest !== plan.beforeStateSha256) {
      throw new Error("BEFORE_STATE_DRIFT");
    }
    return;
  }
  if (!expectedLiveAfterStateSha256) {
    throw new Error("PRODUCTION_NOOP_AFTER_STATE_MISSING");
  }
  const liveAfter = await captureScopedAfterStateDigest(client, plan.scope.saleMonthsIso);
  if (liveAfter !== expectedLiveAfterStateSha256) {
    throw new Error("AFTER_STATE_DRIFT");
  }
}

export async function assertProductionRollbackContextUnderLock(
  client: PoolClient,
  binding: ProductionRollbackWriteBinding,
  plan: MatchedOnlyBundlePlanV1,
  backup: MatchedOnlyScopedBackupV1,
  approvedPlanHash: string,
): Promise<void> {
  const schema = await assertMatchedOnlySchemaReady(client);
  if (!schema.ok) {
    throw new Error(schema.code);
  }
  if (planHashFromPlan(plan) !== approvedPlanHash) {
    throw new Error("PLAN_HASH_MISMATCH");
  }
  if (binding.originalApplyPlanHash !== approvedPlanHash) {
    throw new Error("ROLLBACK_PLAN_HASH_MISMATCH");
  }
  if (binding.rollbackScopeHash !== plan.scope.operationsDigest) {
    throw new Error("ROLLBACK_SCOPE_MISMATCH");
  }
  const backupFailure = validateBackupAgainstPlan(backup, plan, binding.expectedBackupSha256);
  if (backupFailure) {
    throw new Error(backupFailure.code);
  }
  await assertCommonProductionBinding(binding);
  const liveAfter = await captureScopedAfterStateDigest(client, plan.scope.saleMonthsIso);
  if (liveAfter !== binding.expectedLiveAfterStateSha256) {
    throw new Error("ROLLBACK_AFTER_STATE_MISMATCH");
  }
}
