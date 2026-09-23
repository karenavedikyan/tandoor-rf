import crypto from "node:crypto";

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value.trim());
}
