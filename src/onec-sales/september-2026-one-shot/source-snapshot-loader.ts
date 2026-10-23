import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { EXPECTED_SOURCE_FILES, EXPECTED_SOURCE_MANIFEST_SHA256 } from "./scope-pins";
import type { SeptemberSourceBuffers } from "./source-pins";
import { verifySourceBufferPin } from "./source-pins";
import type { OperatorDataScopeV1 } from "./operator-data-scope";
import {
  assertSnapshotDirectorySecurity,
  readSnapshotFileSecure,
  SNAPSHOT_MAX_FILE_BYTES,
} from "./snapshot-path-security";

const MANIFEST_FILE = "manifest.json";

const FIXED_SNAPSHOT_FILE_NAMES = [
  MANIFEST_FILE,
  ...Object.values(EXPECTED_SOURCE_FILES).map((f) => f.fileName),
] as const;

export function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadVerifiedSourceSnapshotFromDirectory(input: {
  directory: string;
  expectedManifestSha256?: string;
  skipManifestShaPin?: boolean;
  skipSourcePinVerification?: boolean;
  skipPathSecurity?: boolean;
  scope?: OperatorDataScopeV1;
}): Promise<
  | { ok: true; buffers: SeptemberSourceBuffers; manifestSha256: string }
  | { ok: false; code: string; message: string }
> {
  if (!input.skipPathSecurity) {
    const dirSec = await assertSnapshotDirectorySecurity(input.directory);
    if (!dirSec.ok) return dirSec;
  }

  let entries: string[];
  try {
    entries = await readdir(input.directory);
  } catch {
    return { ok: false, code: "SNAPSHOT_DIR_MISSING", message: "Snapshot directory missing." };
  }
  const expectedSet = new Set<string>(FIXED_SNAPSHOT_FILE_NAMES);
  if (entries.length !== expectedSet.size || !entries.every((e) => expectedSet.has(e))) {
    return {
      ok: false,
      code: "SNAPSHOT_FILE_SET_MISMATCH",
      message: "Snapshot directory must contain exactly manifest.json and four pinned source files.",
    };
  }

  const manifestRead = input.skipPathSecurity
    ? await readFileUnsafe(input.directory, MANIFEST_FILE)
    : await readSnapshotFileSecure(input.directory, MANIFEST_FILE);
  if (!manifestRead.ok) return manifestRead;
  const manifestBytes = manifestRead.bytes;
  if (manifestBytes.length > SNAPSHOT_MAX_FILE_BYTES) {
    return { ok: false, code: "SNAPSHOT_FILE_TOO_LARGE", message: "manifest.json exceeds 32MiB bound." };
  }
  const manifestSha256 = sha256Buffer(manifestBytes);
  const expectedManifest = input.expectedManifestSha256 ?? EXPECTED_SOURCE_MANIFEST_SHA256;
  if (!input.skipManifestShaPin && manifestSha256 !== expectedManifest) {
    return { ok: false, code: "MANIFEST_SHA_MISMATCH", message: "Snapshot manifest SHA mismatch." };
  }
  if (input.scope && !input.skipManifestShaPin && manifestSha256 !== input.scope.manifestSha256) {
    return { ok: false, code: "MANIFEST_SCOPE_MISMATCH", message: "Manifest SHA does not match operator scope." };
  }

  const buffers = {} as SeptemberSourceBuffers;
  for (const key of Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]) {
    const fileName = EXPECTED_SOURCE_FILES[key].fileName;
    const fileRead = input.skipPathSecurity
      ? await readFileUnsafe(input.directory, fileName)
      : await readSnapshotFileSecure(input.directory, fileName);
    if (!fileRead.ok) return fileRead;
    const bytes = fileRead.bytes;
    if (!input.skipSourcePinVerification) {
      const pin = verifySourceBufferPin(key, bytes);
      if (!pin.ok) {
        return pin;
      }
      if (input.scope) {
        const scopeSrc = input.scope.sources[key];
        const fileSha = sha256Buffer(bytes);
        if (scopeSrc.sha256 !== fileSha || scopeSrc.bytes !== bytes.length) {
          return { ok: false, code: "SOURCE_SCOPE_MISMATCH", message: `Source bytes/SHA mismatch vs scope: ${key}` };
        }
      }
    }
    buffers[key] = bytes;
  }
  return { ok: true, buffers, manifestSha256 };
}

async function readFileUnsafe(
  directory: string,
  fileName: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; code: string; message: string }> {
  const { readFile } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");
  try {
    const bytes = await readFile(joinPath(directory, fileName));
    return { ok: true, bytes };
  } catch {
    return { ok: false, code: "SOURCE_FILE_MISSING", message: `Missing snapshot file ${fileName}.` };
  }
}
