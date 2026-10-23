import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type RuntimeProvenanceResult =
  | { ok: true; label: string; executableArtifactSha256: string }
  | { ok: false; code: "CODE_PROVENANCE_UNVERIFIED"; message: string };

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Verified runtime executable artifact digest — not satisfied by arbitrary label strings alone.
 */
export async function resolveRuntimeExecutableArtifactProof(): Promise<RuntimeProvenanceResult> {
  const fromEnv = process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256?.trim().toLowerCase();
  if (fromEnv && /^[0-9a-f]{64}$/.test(fromEnv)) {
    const label =
      process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL?.trim() ||
      process.env.GIT_COMMIT?.trim() ||
      process.env.CURSOR_COMMIT?.trim() ||
      fromEnv.slice(0, 12);
    return { ok: true, label, executableArtifactSha256: fromEnv };
  }
  const artifactPath = process.env.MATCHED_ONLY_EXECUTABLE_ARTIFACT_PATH?.trim();
  if (artifactPath) {
    try {
      const bytes = await readFile(artifactPath);
      const digest = sha256Hex(bytes);
      const label = process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL?.trim() || digest.slice(0, 12);
      return { ok: true, label, executableArtifactSha256: digest };
    } catch {
      return {
        ok: false,
        code: "CODE_PROVENANCE_UNVERIFIED",
        message: "Executable artifact path is not readable for provenance verification.",
      };
    }
  }
  return {
    ok: false,
    code: "CODE_PROVENANCE_UNVERIFIED",
    message:
      "Runtime executable artifact SHA unavailable (set MATCHED_ONLY_EXECUTABLE_ARTIFACT_SHA256 or MATCHED_ONLY_EXECUTABLE_ARTIFACT_PATH).",
  };
}

/** @deprecated Use resolveRuntimeExecutableArtifactProof — label alone is not proof. */
export function resolveRuntimeCodeArtifactLabel(): RuntimeProvenanceResult | { ok: false; code: string; message: string } {
  const label =
    process.env.MATCHED_ONLY_CODE_ARTIFACT_LABEL?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    process.env.CURSOR_COMMIT?.trim() ||
    "";
  if (!label) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message: "Runtime code artifact label unavailable.",
    };
  }
  return { ok: false, code: "CODE_PROVENANCE_UNVERIFIED", message: "Label without executable artifact SHA is not verified provenance." };
}

export async function assertManifestCodeProvenance(
  manifestLabel: string | null,
  manifestExecutableSha256: string | null,
  requireMatch: boolean,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!requireMatch) {
    return { ok: true };
  }
  if (!manifestExecutableSha256?.trim()) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message: "Manifest expectedExecutableArtifactSha256 is required for verified write.",
    };
  }
  const runtime = await resolveRuntimeExecutableArtifactProof();
  if (!runtime.ok) {
    return { ok: false, code: runtime.code, message: runtime.message };
  }
  if (manifestExecutableSha256.toLowerCase() !== runtime.executableArtifactSha256.toLowerCase()) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message: "Runtime executable artifact digest does not match manifest pin.",
    };
  }
  if (manifestLabel?.trim() && manifestLabel !== runtime.label) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message: "Runtime code artifact label does not match manifest provenance label.",
    };
  }
  return { ok: true };
}
