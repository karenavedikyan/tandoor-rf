import crypto from "crypto";
import { requireHandoffOtpPepper } from "../otp-config";

export type ExternalPersonSessionPayload = {
  personId: string;
  exp: number;
  epoch?: number;
};

export function hashExternalPersonSessionToken(raw: string, pepper: string): Buffer {
  return crypto.createHmac("sha256", pepper).update(`ext-person:${raw}`).digest();
}

export function mintExternalPersonSessionToken(personId: string, ttlMs: number): { raw: string; hash: Buffer; exp: Date } {
  const raw = crypto.randomBytes(24).toString("base64url");
  const pepper = requireHandoffOtpPepper();
  const hash = hashExternalPersonSessionToken(raw, pepper);
  const exp = new Date(Date.now() + ttlMs);
  return { raw, hash, exp };
}

export function signExternalPersonCapability(personId: string, ttlMs: number, epoch: number): string {
  const pepper = requireHandoffOtpPepper();
  const body = Buffer.from(JSON.stringify({ personId, exp: Date.now() + ttlMs, epoch }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", pepper).update(`ext-cap:${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyExternalPersonCapability(token: string): ExternalPersonSessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  let pepper: string;
  try {
    pepper = requireHandoffOtpPepper();
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", pepper).update(`ext-cap:${body}`).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ExternalPersonSessionPayload;
    if (!payload.personId || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
