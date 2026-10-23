import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type RuntimeProvenanceResult =
  | { ok: true; label: string; executableArtifactSha256: string }
  | { ok: false; code: "CODE_PROVENANCE_UNVERIFIED"; message: string };

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isAllowedExecutableArtifactPath(path: string): boolean {
  const resolved = resolve(path);
  const productionBundle = resolve(process.cwd(), "dist/cli/onec-v3-sales-matched-bundle-production.js");
  const syntheticFixture = resolve(process.cwd(), "test/fixtures/matched-only-synthetic-executable-artifact.bin");
  return resolved === productionBundle || resolved === syntheticFixture;
}

async function measureExecutableArtifactBytes(): Promise<Buffer | null> {
  const pinned = process.env.MATCHED_ONLY_PINNED_EXECUTABLE_ARTIFACT_PATH?.trim();
  const candidates = [
    pinned,
    join(process.cwd(), "dist/cli/onec-v3-sales-matched-bundle-production.js"),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    if (!isAllowedExecutableArtifactPath(path)) {
      continue;
    }
    try {
      return await readFile(path);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Measured digest of the pinned on-disk executor artifact. Env SHA alone is never proof.
 */
export async function resolveRuntimeExecutableArtifactProof(): Promise<RuntimeProvenanceResult> {
  const bytes = await measureExecutableArtifactBytes();
  if (!bytes) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message: "Executable artifact bytes could not be measured from pinned path.",
    };
  }
  const digest = sha256Hex(bytes);
  const pinnedLabel = process.env.MATCHED_ONLY_PINNED_CODE_ARTIFACT_LABEL?.trim();
  if (!pinnedLabel) {
    return {
      ok: false,
      code: "CODE_PROVENANCE_UNVERIFIED",
      message: "Pinned code artifact label is required for verified provenance.",
    };
  }
  return { ok: true, label: pinnedLabel, executableArtifactSha256: digest };
}

export function resolveRuntimeCodeArtifactLabel(): { ok: false; code: string; message: string } {
  return {
    ok: false,
    code: "CODE_PROVENANCE_UNVERIFIED",
    message: "Label without measured executable artifact is not verified provenance.",
  };
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
      message: "Manifest pin does not match measured executable artifact digest.",
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
