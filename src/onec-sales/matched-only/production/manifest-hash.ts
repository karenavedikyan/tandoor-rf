import { sha256CanonicalJson } from "../canonical-json";
import type { ExecutionManifestV2 } from "./manifest-types";

/** Canonical actionable body: excludes only self-referential hash/signature fields. */
export function executionManifestContentPayload(manifest: ExecutionManifestV2): Record<string, unknown> {
  const { contentHash: _contentHash, approval, provenance, privateBackupCapture, ...rest } = manifest;
  const { approvedExecutionHash: _approvedHash, ...approvalBody } = approval;
  const captureBody =
    privateBackupCapture == null
      ? privateBackupCapture
      : (() => {
          const { approvedCaptureHash: _captureHash, ...body } = privateBackupCapture;
          return body;
        })();
  return {
    ...rest,
    privateBackupCapture: captureBody,
    approval: approvalBody,
    provenance: {
      codeArtifactLabel: provenance.codeArtifactLabel,
      expectedExecutableArtifactSha256: provenance.expectedExecutableArtifactSha256,
      observedRuntimeFingerprint: null,
    },
  };
}

export function computePrivateCaptureBindingHash(manifest: ExecutionManifestV2): string {
  const capture = manifest.privateBackupCapture;
  if (!capture?.destinationPath) {
    return "";
  }
  return sha256CanonicalJson({
    destinationPath: capture.destinationPath,
    planHash: manifest.planHash,
    targetDbFingerprint: manifest.plan?.identity.targetDbFingerprint ?? manifest.target.expectedDbFingerprint,
    executionId: manifest.executionId,
  });
}

export function computeExecutionManifestContentHash(manifest: ExecutionManifestV2): string {
  return sha256CanonicalJson(executionManifestContentPayload(manifest));
}

/** Approved execution hash must equal contentHash — binds operator consent to exact actionable body. */
export function computeApprovedExecutionBindingHash(manifest: ExecutionManifestV2): string {
  return computeExecutionManifestContentHash(manifest);
}

export function withComputedContentHash(manifest: ExecutionManifestV2): ExecutionManifestV2 {
  const contentHash = computeExecutionManifestContentHash({ ...manifest, contentHash: "" });
  return { ...manifest, contentHash };
}

export function withBoundCaptureHash(manifest: ExecutionManifestV2): ExecutionManifestV2 {
  const withHash = withComputedContentHash(manifest);
  const capture = withHash.privateBackupCapture;
  if (!capture || capture.status !== "APPROVED") {
    return withHash;
  }
  const binding = computePrivateCaptureBindingHash(withHash);
  return {
    ...withHash,
    privateBackupCapture: {
      ...capture,
      approvedCaptureHash: binding,
    },
  };
}

export function withBoundApprovalHash(manifest: ExecutionManifestV2): ExecutionManifestV2 {
  const withHash = withComputedContentHash(manifest);
  if (withHash.approval.status !== "APPROVED") {
    return withHash;
  }
  const binding = computeApprovedExecutionBindingHash(withHash);
  return {
    ...withHash,
    approval: {
      ...withHash.approval,
      approvedExecutionHash: binding,
    },
  };
}
