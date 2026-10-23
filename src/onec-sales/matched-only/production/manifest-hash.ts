import { sha256CanonicalJson } from "../canonical-json";
import type { ExecutionManifestV2 } from "./manifest-types";

/** Canonical actionable body: excludes self-referential hashes and approval signatures. */
export function executionManifestContentPayload(manifest: ExecutionManifestV2): Record<string, unknown> {
  const { provenance, contentHash: _contentHash, approval: _approval, ...rest } = manifest;
  return {
    ...rest,
    provenance: {
      codeArtifactLabel: provenance.codeArtifactLabel,
      observedRuntimeFingerprint: null,
    },
  };
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
