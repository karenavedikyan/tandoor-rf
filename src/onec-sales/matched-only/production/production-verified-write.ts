import { createHash } from "node:crypto";
import type { ProductionApplyWriteBinding, ProductionRollbackWriteBinding } from "./apply-write-guard";
import type { ExecutionManifestV2 } from "./manifest-types";
import type { MatchedOnlyBundlePlanV1 } from "../types";
import { planHashFromPlan } from "../plan-build";
import { validateExecutionManifestForRun } from "./manifest-validate";
import { assertManifestCodeProvenance } from "./runtime-provenance";
import { matchedTotalsEqual } from "./manifest-budget";
import {
  deriveProductionApplyBindingFromManifest,
  deriveProductionRollbackBindingFromManifest,
} from "./production-binding";

type FrozenApplyGrant = {
  operation: "apply";
  manifestContentHash: string;
  approvedExecutionHash: string;
  approvedPlanHash: string;
  approvedPlan: MatchedOnlyBundlePlanV1;
  applyBinding: ProductionApplyWriteBinding;
};

type FrozenRollbackGrant = {
  operation: "rollback";
  manifestContentHash: string;
  approvedExecutionHash: string;
  approvedPlanHash: string;
  approvedPlan: MatchedOnlyBundlePlanV1;
  rollbackBinding: ProductionRollbackWriteBinding;
};

type WriteGrant = FrozenApplyGrant | FrozenRollbackGrant;

const grants = new Map<string, WriteGrant>();

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function bindingsEqualApply(a: ProductionApplyWriteBinding, b: ProductionApplyWriteBinding): boolean {
  return (
    a.manifestContentHash === b.manifestContentHash &&
    a.codeArtifactLabel === b.codeArtifactLabel &&
    a.expectedExecutableArtifactSha256 === b.expectedExecutableArtifactSha256 &&
    a.approvalValidUntil === b.approvalValidUntil &&
    a.expectedBackupSha256 === b.expectedBackupSha256 &&
    matchedTotalsEqual(a.executionBudget.matchedTotals, b.executionBudget.matchedTotals) &&
    JSON.stringify(a.executionBudget) === JSON.stringify(b.executionBudget)
  );
}

function bindingsEqualRollback(a: ProductionRollbackWriteBinding, b: ProductionRollbackWriteBinding): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertApprovedPlanPresent(
  manifest: ExecutionManifestV2,
): { ok: true; plan: MatchedOnlyBundlePlanV1; planHash: string } | { ok: false; code: string; message: string } {
  if (!manifest.plan || !manifest.planHash) {
    return { ok: false, code: "MANIFEST_PLAN_MISSING", message: "Manifest missing embedded plan." };
  }
  if (planHashFromPlan(manifest.plan) !== manifest.planHash) {
    return { ok: false, code: "MANIFEST_PLAN_HASH_MISMATCH", message: "Manifest planHash mismatch." };
  }
  return { ok: true, plan: manifest.plan, planHash: manifest.planHash };
}

export async function mintProductionWriteGrant(input: {
  manifest: ExecutionManifestV2;
  operation: "apply" | "rollback";
  approvedExecutionHash: string;
}): Promise<{ ok: true; grantId: string } | { ok: false; code: string; message: string }> {
  const manifestCheck = validateExecutionManifestForRun({
    manifest: input.manifest,
    operation: input.operation,
    requireApproved: true,
    approvedExecutionHash: input.approvedExecutionHash,
  });
  if (!manifestCheck.ok) {
    return { ok: false, code: manifestCheck.code, message: manifestCheck.message };
  }
  const provenance = await assertManifestCodeProvenance(
    input.manifest.provenance.codeArtifactLabel,
    input.manifest.provenance.expectedExecutableArtifactSha256,
    true,
  );
  if (!provenance.ok) {
    return { ok: false, code: provenance.code, message: provenance.message };
  }
  const manifest = manifestCheck.manifest;
  const planCheck = assertApprovedPlanPresent(manifest);
  if (!planCheck.ok) {
    return planCheck;
  }
  if (input.approvedExecutionHash.toLowerCase() !== manifest.contentHash.toLowerCase()) {
    return { ok: false, code: "MANIFEST_APPROVED_HASH_MISMATCH", message: "Approved hash mismatch." };
  }

  const grantId = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex");
  if (input.operation === "apply") {
    const derived = deriveProductionApplyBindingFromManifest(manifest);
    if (!derived) {
      return { ok: false, code: "PRODUCTION_BINDING_INCOMPLETE", message: "Manifest missing apply binding fields." };
    }
    grants.set(grantId, {
      operation: "apply",
      manifestContentHash: manifest.contentHash,
      approvedExecutionHash: input.approvedExecutionHash,
      approvedPlanHash: planCheck.planHash,
      approvedPlan: deepClone(planCheck.plan),
      applyBinding: deepClone(derived),
    });
    return { ok: true, grantId };
  }

  const derived = deriveProductionRollbackBindingFromManifest(manifest);
  if (!derived) {
    return { ok: false, code: "PRODUCTION_BINDING_INCOMPLETE", message: "Manifest missing rollback binding fields." };
  }
  grants.set(grantId, {
    operation: "rollback",
    manifestContentHash: manifest.contentHash,
    approvedExecutionHash: input.approvedExecutionHash,
    approvedPlanHash: planCheck.planHash,
    approvedPlan: deepClone(planCheck.plan),
    rollbackBinding: deepClone(derived),
  });
  return { ok: true, grantId };
}

export function consumeProductionWriteGrant(
  grantId: string,
  operation: "apply" | "rollback",
  binding: ProductionApplyWriteBinding | ProductionRollbackWriteBinding,
  approvedPlanHash: string,
  plan: MatchedOnlyBundlePlanV1,
  expectedBackupSha256: string,
): { ok: true; grant: WriteGrant } | { ok: false; code: string; message: string } {
  const grant = grants.get(grantId);
  if (!grant) {
    return { ok: false, code: "PRODUCTION_WRITE_GRANT_INVALID", message: "Missing production write grant." };
  }
  grants.delete(grantId);
  if (grant.operation !== operation) {
    return { ok: false, code: "PRODUCTION_WRITE_GRANT_INVALID", message: "Grant operation mismatch." };
  }
  if (binding.manifestContentHash !== grant.manifestContentHash) {
    return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Binding does not match granted manifest." };
  }
  if (approvedPlanHash !== grant.approvedPlanHash) {
    return { ok: false, code: "PRODUCTION_PLAN_HASH_MISMATCH", message: "Approved plan hash drift." };
  }
  if (planHashFromPlan(plan) !== grant.approvedPlanHash) {
    return { ok: false, code: "PRODUCTION_PLAN_HASH_MISMATCH", message: "Live plan hash drift." };
  }
  if (
    plan.scope.operationsDigest !== grant.approvedPlan.scope.operationsDigest ||
    plan.beforeStateSha256 !== grant.approvedPlan.beforeStateSha256 ||
    plan.identity.targetDbFingerprint !== grant.approvedPlan.identity.targetDbFingerprint
  ) {
    return { ok: false, code: "PRODUCTION_PLAN_CONTEXT_MISMATCH", message: "Plan scope/identity drift from grant." };
  }

  if (operation === "apply") {
    const applyGrant = grant as FrozenApplyGrant;
    const applyBinding = binding as ProductionApplyWriteBinding;
    if (!bindingsEqualApply(applyBinding, applyGrant.applyBinding)) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Apply binding drift." };
    }
    if (expectedBackupSha256 !== applyGrant.applyBinding.expectedBackupSha256) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Backup SHA drift." };
    }
  } else {
    const rollbackGrant = grant as FrozenRollbackGrant;
    const rollbackBinding = binding as ProductionRollbackWriteBinding;
    if (!bindingsEqualRollback(rollbackBinding, rollbackGrant.rollbackBinding)) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Rollback binding drift." };
    }
    if (expectedBackupSha256 !== rollbackGrant.rollbackBinding.expectedBackupSha256) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Backup SHA drift." };
    }
  }
  return { ok: true, grant };
}
