import type { PoolClient } from "pg";
import { captureScopedBeforeState } from "../state-digest";
import type { MatchedOnlyBundlePlanV1, MatchedOnlyScopedBackupV1 } from "../types";
import { validateBackupAgainstPlan } from "../guards";
import { planHashFromPlan } from "../plan-build";
import type { ExecutionManifestBudgetV2 } from "./manifest-types";
import { validateManifestBudgetAgainstPlan } from "./manifest-budget";
import { assertMatchedOnlySchemaReady } from "./schema-readiness";

export type ProductionApplyWriteBinding = {
  manifestContentHash: string;
  codeArtifactLabel: string;
  approvalValidUntil: string;
  executionBudget: ExecutionManifestBudgetV2;
  expectedBackupSha256: string;
};

export async function assertProductionApplyContextUnderLock(
  client: PoolClient,
  binding: ProductionApplyWriteBinding,
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
  const budgetCheck = validateManifestBudgetAgainstPlan(plan, binding.executionBudget);
  if (!budgetCheck.ok) {
    throw new Error(budgetCheck.code);
  }
  const backupFailure = validateBackupAgainstPlan(backup, plan, binding.expectedBackupSha256);
  if (backupFailure) {
    throw new Error(backupFailure.code);
  }
  const liveBefore = await captureScopedBeforeState(client, plan.scope.saleMonthsIso);
  if (liveBefore.businessDigest !== plan.beforeStateSha256) {
    throw new Error("BEFORE_STATE_DRIFT");
  }
  const expires = Date.parse(binding.approvalValidUntil);
  if (Number.isNaN(expires) || Date.now() > expires) {
    throw new Error("MANIFEST_APPROVAL_EXPIRED");
  }
  if (!binding.manifestContentHash?.trim() || !binding.codeArtifactLabel?.trim()) {
    throw new Error("PRODUCTION_BINDING_INCOMPLETE");
  }
}
