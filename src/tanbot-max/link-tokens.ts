import crypto from "crypto";
import { MAX_START_PAYLOAD_MAX_LEN } from "./stage2-config";

export function generateLinkStartToken(): string {
  const bytes = crypto.randomBytes(32);
  return bytes
    .toString("base64url")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, MAX_START_PAYLOAD_MAX_LEN);
}

export function hashLinkStartToken(token: string, pepper: string): string {
  return crypto.createHmac("sha256", pepper).update(token).digest("hex");
}

/** Official MAX bot deep link: https://max.ru/<botName>?start=<payload> */
export function buildMaxDeepLink(botUsername: string, startToken: string): string {
  const user = botUsername.replace(/^@+/, "");
  return `https://max.ru/${encodeURIComponent(user)}?start=${encodeURIComponent(startToken)}`;
}
