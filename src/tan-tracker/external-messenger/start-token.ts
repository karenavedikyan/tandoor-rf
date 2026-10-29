import crypto from "crypto";
import {
  EXTERNAL_MESSENGER_START_PREFIX,
  EXTERNAL_MESSENGER_START_TOKEN_LEN,
  externalMessengerTokenPepper,
} from "./config";

export function generateExternalMessengerStartToken(): string {
  const body = crypto.randomBytes(32).toString("base64url").slice(0, EXTERNAL_MESSENGER_START_TOKEN_LEN);
  return `${EXTERNAL_MESSENGER_START_PREFIX}${body}`;
}

export function isExternalMessengerStartToken(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  const t = raw.trim();
  return t.startsWith(EXTERNAL_MESSENGER_START_PREFIX) && t.length === EXTERNAL_MESSENGER_START_PREFIX.length + EXTERNAL_MESSENGER_START_TOKEN_LEN;
}

export function hashExternalMessengerStartToken(token: string): Buffer {
  const pepper = externalMessengerTokenPepper();
  return crypto.createHmac("sha256", pepper).update(token.trim()).digest();
}
