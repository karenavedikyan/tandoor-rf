import { sha256CanonicalJson } from "../canonical-json";
import type { ExecutionManifestV2 } from "./manifest-types";

/** Hash manifest body excluding volatile runtime observation fields. */
export function executionManifestContentPayload(manifest: ExecutionManifestV2): Record<string, unknown> {
  const { provenance, contentHash: _contentHash, ...rest } = manifest;
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

export function withComputedContentHash(manifest: ExecutionManifestV2): ExecutionManifestV2 {
  const contentHash = computeExecutionManifestContentHash({ ...manifest, contentHash: "" });
  return { ...manifest, contentHash };
}
