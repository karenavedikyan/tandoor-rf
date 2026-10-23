import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXPECTED_SOURCE_FILES, EXPECTED_SOURCE_MANIFEST_SHA256 } from "./scope-pins";
import type { SeptemberSourceBuffers } from "./source-pins";
import { verifySourceBufferPin } from "./source-pins";

const MANIFEST_FILE = "manifest.json";

export function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadVerifiedSourceSnapshotFromDirectory(input: {
  directory: string;
  expectedManifestSha256?: string;
  skipManifestShaPin?: boolean;
  skipSourcePinVerification?: boolean;
}): Promise<
  | { ok: true; buffers: SeptemberSourceBuffers; manifestSha256: string }
  | { ok: false; code: string; message: string }
> {
  const manifestPath = join(input.directory, MANIFEST_FILE);
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch {
    return { ok: false, code: "MANIFEST_MISSING", message: "manifest.json missing from snapshot directory." };
  }
  const manifestSha256 = sha256Buffer(manifestBytes);
  const expectedManifest = input.expectedManifestSha256 ?? EXPECTED_SOURCE_MANIFEST_SHA256;
  if (!input.skipManifestShaPin && manifestSha256 !== expectedManifest) {
    return { ok: false, code: "MANIFEST_SHA_MISMATCH", message: "Snapshot manifest SHA mismatch." };
  }
  const buffers = {} as SeptemberSourceBuffers;
  for (const key of Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[]) {
    const fileName = EXPECTED_SOURCE_FILES[key].fileName;
    const filePath = join(input.directory, fileName);
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch {
      return { ok: false, code: "SOURCE_FILE_MISSING", message: `Missing snapshot file ${fileName}.` };
    }
    if (!input.skipSourcePinVerification) {
      const pin = verifySourceBufferPin(key, bytes);
      if (!pin.ok) {
        return pin;
      }
    }
    buffers[key] = bytes;
  }
  return { ok: true, buffers, manifestSha256 };
}
