import { createHash } from "node:crypto";

export function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeBundleFingerprint(fileSha256: Record<string, string>): string {
  const ordered = Object.keys(fileSha256)
    .sort()
    .map((key) => `${key}=${fileSha256[key]}`)
    .join("|");
  return createHash("sha256").update(ordered, "utf8").digest("hex");
}
