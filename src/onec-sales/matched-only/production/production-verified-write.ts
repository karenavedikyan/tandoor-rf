import { createHash } from "node:crypto";
import type { ProductionApplyWriteBinding, ProductionRollbackWriteBinding } from "./apply-write-guard";
import type { ExecutionManifestV2 } from "./manifest-types";
import { validateExecutionManifestForRun } from "./manifest-validate";
import { assertManifestCodeProvenance } from "./runtime-provenance";
import { matchedTotalsEqual } from "./manifest-budget";

type WriteGrant = {
  operation: "apply" | "rollback";
  manifestContentHash: string;
  approvedExecutionHash: string;
  applyBinding?: ProductionApplyWriteBinding;
  rollbackBinding?: ProductionRollbackWriteBinding;
};

const grants = new Map<string, WriteGrant>();

function bindingsEqualApply(a: ProductionApplyWriteBinding, b: ProductionApplyWriteBinding): boolean {
  return (
    a.manifestContentHash === b.manifestContentHash &&
    a.codeArtifactLabel === b.codeArtifactLabel &&
    a.expectedExecutableArtifactSha256 === b.expectedExecutableArtifactSha256 &&
    a.approvalValidUntil === b.approvalValidUntil &&
    a.expectedBackupSha256 === b.expectedBackupSha256 &&
    matchedTotalsEqual(a.executionBudget.matchedTotals, b.executionBudget.matchedTotals)
  );
}

function bindingsEqualRollback(a: ProductionRollbackWriteBinding, b: ProductionRollbackWriteBinding): boolean {
  return (
    a.manifestContentHash === b.manifestContentHash &&
    a.codeArtifactLabel === b.codeArtifactLabel &&
    a.expectedExecutableArtifactSha256 === b.expectedExecutableArtifactSha256 &&
    a.approvalValidUntil === b.approvalValidUntil &&
    a.expectedBackupSha256 === b.expectedBackupSha256 &&
    a.originalApplyPlanHash === b.originalApplyPlanHash &&
    a.expectedLiveAfterStateSha256 === b.expectedLiveAfterStateSha256 &&
    a.rollbackScopeHash === b.rollbackScopeHash
  );
}

export async function mintProductionWriteGrant(input: {
  manifest: ExecutionManifestV2;
  operation: "apply" | "rollback";
  approvedExecutionHash: string;
  applyBinding?: ProductionApplyWriteBinding;
  rollbackBinding?: ProductionRollbackWriteBinding;
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
  if (input.operation === "apply") {
    const binding = input.applyBinding;
    if (!binding || binding.manifestContentHash !== manifest.contentHash) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Apply binding does not match manifest." };
    }
    if (input.approvedExecutionHash.toLowerCase() !== manifest.contentHash.toLowerCase()) {
      return { ok: false, code: "MANIFEST_APPROVED_HASH_MISMATCH", message: "Approved hash mismatch." };
    }
  } else {
    const binding = input.rollbackBinding;
    if (!binding || binding.manifestContentHash !== manifest.contentHash) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Rollback binding does not match manifest." };
    }
    if (input.approvedExecutionHash.toLowerCase() !== manifest.contentHash.toLowerCase()) {
      return { ok: false, code: "MANIFEST_APPROVED_HASH_MISMATCH", message: "Approved hash mismatch." };
    }
  }
  const grantId = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex");
  grants.set(grantId, {
    operation: input.operation,
    manifestContentHash: manifest.contentHash,
    approvedExecutionHash: input.approvedExecutionHash,
    applyBinding: input.applyBinding,
    rollbackBinding: input.rollbackBinding,
  });
  return { ok: true, grantId };
}

export function consumeProductionWriteGrant(
  grantId: string,
  operation: "apply" | "rollback",
  binding: ProductionApplyWriteBinding | ProductionRollbackWriteBinding,
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
  if (operation === "apply") {
    const applyBinding = binding as ProductionApplyWriteBinding;
    if (!grant.applyBinding || !bindingsEqualApply(applyBinding, grant.applyBinding)) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Apply binding drift." };
    }
  } else {
    const rollbackBinding = binding as ProductionRollbackWriteBinding;
    if (!grant.rollbackBinding || !bindingsEqualRollback(rollbackBinding, grant.rollbackBinding)) {
      return { ok: false, code: "PRODUCTION_BINDING_MISMATCH", message: "Rollback binding drift." };
    }
  }
  return { ok: true, grant };
}
