import type { TelegramGetMeResult } from "./types";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const MAX_WEBHOOK_ERROR_EPOCH_SEC = 4_102_444_800; // 2100-01-01 UTC

export type ValidatedWebhookInfo = {
  url: string;
  pendingUpdateCount: number;
  lastErrorAt: string | null;
  lastErrorReported: boolean;
};

export function safeUnixSecondsToIso(unixSec: number): string | null {
  if (!Number.isFinite(unixSec) || unixSec <= 0 || unixSec > MAX_WEBHOOK_ERROR_EPOCH_SEC) {
    return null;
  }
  const date = new Date(unixSec * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function parseTelegramGetMeResult(raw: unknown):
  | { ok: true; me: TelegramGetMeResult }
  | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Telegram getMe response is invalid." };
  }
  const row = raw as Record<string, unknown>;
  const id = row.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "Telegram getMe response is invalid." };
  }
  if (row.is_bot !== true) {
    return { ok: false, message: "Telegram getMe response is invalid." };
  }
  let username: string | undefined;
  if (row.username !== undefined) {
    if (typeof row.username !== "string") {
      return { ok: false, message: "Telegram getMe response is invalid." };
    }
    const normalized = row.username.replace(/^@+/, "");
    if (!USERNAME_PATTERN.test(normalized)) {
      return { ok: false, message: "Telegram getMe response is invalid." };
    }
    username = normalized;
  }
  const first_name = typeof row.first_name === "string" ? row.first_name : undefined;
  return { ok: true, me: { id, is_bot: true, username, first_name } };
}

export function parseTelegramWebhookInfoResult(raw: unknown):
  | { ok: true; info: ValidatedWebhookInfo }
  | { ok: false; message: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
  }
  const row = raw as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(row, "url")) {
    return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
  }
  if (typeof row.url !== "string") {
    return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
  }
  const url = row.url.trim();

  if (!Object.prototype.hasOwnProperty.call(row, "has_custom_certificate")) {
    return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
  }
  if (typeof row.has_custom_certificate !== "boolean") {
    return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
  }

  if (!Object.prototype.hasOwnProperty.call(row, "pending_update_count")) {
    return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
  }
  const pending = row.pending_update_count;
  if (typeof pending !== "number" || !Number.isInteger(pending) || pending < 0) {
    return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
  }
  const pendingUpdateCount = pending;

  let lastErrorAt: string | null = null;
  if (row.last_error_date !== undefined) {
    if (typeof row.last_error_date !== "number" || !Number.isFinite(row.last_error_date)) {
      return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
    }
    lastErrorAt = safeUnixSecondsToIso(row.last_error_date);
    if (row.last_error_date > 0 && !lastErrorAt) {
      return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
    }
  }

  let lastErrorReported = false;
  if (row.last_error_message !== undefined) {
    if (typeof row.last_error_message !== "string") {
      return { ok: false, message: "Telegram getWebhookInfo response is invalid." };
    }
    if (row.last_error_message.trim().length > 0) {
      lastErrorReported = true;
    }
  }

  return {
    ok: true,
    info: {
      url,
      pendingUpdateCount,
      lastErrorAt,
      lastErrorReported,
    },
  };
}
