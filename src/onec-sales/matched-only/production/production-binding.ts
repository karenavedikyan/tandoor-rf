import type { ExecutionManifestV2 } from "./manifest-types";
import type { ProductionApplyWriteBinding, ProductionRollbackWriteBinding } from "./apply-write-guard";

export function deriveProductionApplyBindingFromManifest(
  manifest: ExecutionManifestV2,
): ProductionApplyWriteBinding | null {
  if (
    !manifest.executionBudget ||
    !manifest.provenance.codeArtifactLabel ||
    !manifest.provenance.expectedExecutableArtifactSha256 ||
    !manifest.approval.validUntil ||
    !manifest.backup.expectedSha256
  ) {
    return null;
  }
  return {
    manifestContentHash: manifest.contentHash,
    codeArtifactLabel: manifest.provenance.codeArtifactLabel,
    expectedExecutableArtifactSha256: manifest.provenance.expectedExecutableArtifactSha256,
    approvalValidUntil: manifest.approval.validUntil,
    executionBudget: manifest.executionBudget,
    expectedBackupSha256: manifest.backup.expectedSha256,
  };
}

export function deriveProductionRollbackBindingFromManifest(
  manifest: ExecutionManifestV2,
): ProductionRollbackWriteBinding | null {
  const rollback = manifest.rollback;
  if (
    !manifest.provenance.codeArtifactLabel ||
    !manifest.provenance.expectedExecutableArtifactSha256 ||
    !manifest.approval.validUntil ||
    !manifest.backup.expectedSha256 ||
    !rollback?.originalApplyPlanHash ||
    !rollback.expectedLiveAfterStateSha256 ||
    !rollback.rollbackScopeHash
  ) {
    return null;
  }
  return {
    manifestContentHash: manifest.contentHash,
    codeArtifactLabel: manifest.provenance.codeArtifactLabel,
    expectedExecutableArtifactSha256: manifest.provenance.expectedExecutableArtifactSha256,
    approvalValidUntil: manifest.approval.validUntil,
    expectedBackupSha256: manifest.backup.expectedSha256,
    originalApplyPlanHash: rollback.originalApplyPlanHash,
    expectedLiveAfterStateSha256: rollback.expectedLiveAfterStateSha256,
    rollbackScopeHash: rollback.rollbackScopeHash,
  };
}
