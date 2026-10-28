import crypto from "crypto";
import { requireHandoffOtpPepper } from "./otp-config";

export type InvitationTokenPayload = {
  transferId: string;
  hv: number;
  pendingPartyId: string;
  exp: number;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function signInvitationToken(payload: InvitationTokenPayload): string {
  const pepper = requireHandoffOtpPepper();
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", pepper).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifyInvitationToken(token: string): InvitationTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sigB64] = parts;
  if (!body || !sigB64) return null;
  let pepper: string;
  try {
    pepper = requireHandoffOtpPepper();
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", pepper).update(body).digest();
  const got = fromB64url(sigB64);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as InvitationTokenPayload;
    if (!payload.transferId || !payload.pendingPartyId || !payload.hv || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function invitationTokenTtlMs(): number {
  return 7 * 24 * 60 * 60 * 1000;
}
