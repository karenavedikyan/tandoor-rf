import crypto from "crypto";
import { requireHandoffOtpPepper } from "./otp-config";

export type HolderAccessPayload = {
  transferId: string;
  partyId: string;
  hv: number;
  exp: number;
};

export function signHolderAccess(payload: HolderAccessPayload): string {
  const pepper = requireHandoffOtpPepper();
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", pepper).update(`holder:${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyHolderAccess(token: string): HolderAccessPayload | null {
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
  const expected = crypto.createHmac("sha256", pepper).update(`holder:${body}`).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HolderAccessPayload;
    if (!payload.transferId || !payload.partyId || !payload.hv || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function holderAccessTtlMs(): number {
  return 7 * 24 * 60 * 60 * 1000;
}
