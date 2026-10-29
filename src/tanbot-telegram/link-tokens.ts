import crypto from "crypto";
import { TELEGRAM_START_PAYLOAD_MAX_LEN } from "./stage2-config";

/** URL-safe token for Telegram /start deep link (payload max 64 chars). */
export function generateLinkStartToken(): string {
  const bytes = crypto.randomBytes(32);
  return bytes
    .toString("base64url")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, TELEGRAM_START_PAYLOAD_MAX_LEN);
}

export function hashLinkStartToken(token: string, pepper: string): string {
  return crypto.createHmac("sha256", pepper).update(token).digest("hex");
}

export function buildTelegramDeepLink(botUsername: string, startToken: string): string {
  const user = botUsername.replace(/^@+/, "");
  return `https://t.me/${encodeURIComponent(user)}?start=${encodeURIComponent(startToken)}`;
}
