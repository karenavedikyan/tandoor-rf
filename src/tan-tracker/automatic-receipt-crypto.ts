import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { requireHandoffOtpPepper } from "./otp-config";

function key() {
  return createHmac("sha256", requireHandoffOtpPepper())
    .update("tandoor:automatic-receipt:v1")
    .digest();
}
export function encryptAutomaticReceiptCode(
  code: string,
  context: string,
): string {
  if (!/^\d{6}$/.test(code)) throw new Error("INVALID_CODE");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(code, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptAutomaticReceiptCode(
  encrypted: string,
  context: string,
): string {
  const parts = encrypted.split(".").map((p) => Buffer.from(p, "base64url"));
  if (
    parts.length !== 3 ||
    parts[0].length !== 12 ||
    parts[1].length !== 16 ||
    parts[2].length !== 6
  )
    throw new Error("INVALID_CODE");
  const cipher = createDecipheriv("aes-256-gcm", key(), parts[0]);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(parts[1]);
  const code = Buffer.concat([
    cipher.update(parts[2]),
    cipher.final(),
  ]).toString("utf8");
  if (!/^\d{6}$/.test(code)) throw new Error("INVALID_CODE");
  return code;
}
