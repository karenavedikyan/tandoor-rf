export type RuntimeProvenanceResult =
  | { ok: true; label: string }
  | { ok: false; code: "CODE_PROVENANCE_UNVERIFIED"; message: string };

/**
 * Best-effort runtime code artifact label. Does not treat arbitrary CLI flags as proof of revision.
 */
export function resolveRuntimeCodeArtifactLabel(): RuntimeProvenanceResult {
  const label =
    process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    process.env.CURSOR_COMMIT?.trim() ||
    "";
  if (!label) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message:
        "Runtime code artifact label unavailable (set MATCHED_ONLY_CODE_ARTIFACT_LABEL for verified write).",
    };
  }
  return { ok: true, label };
}

export function assertManifestCodeProvenance(
  manifestLabel: string | null,
  runtime: RuntimeProvenanceResult,
  requireMatch: boolean,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!requireMatch) {
    return { ok: true };
  }
  if (!runtime.ok) {
    return { ok: false, code: runtime.code, message: runtime.message };
  }
  if (manifestLabel && manifestLabel !== runtime.label) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message: "Runtime code artifact does not match manifest provenance label.",
    };
  }
  return { ok: true };
}
