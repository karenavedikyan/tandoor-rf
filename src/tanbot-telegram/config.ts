import { SAFE_CONFIG_MESSAGE } from "./safe-errors";
import type { TanbotTelegramConfig, TanbotTelegramConfigLoadResult } from "./types";

export const DEFAULT_EXPECTED_BOT_USERNAME = "TANDOOR_IBOT";
export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 65_536;
const MIN_MAX_RESPONSE_BYTES = 4_096;
const MAX_MAX_RESPONSE_BYTES = 262_144;

const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;

export function isTanbotTelegramEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_TELEGRAM_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (!raw?.trim()) return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function readBotToken(env: NodeJS.ProcessEnv): string | null {
  const raw = env.TANBOT_TELEGRAM_BOT_TOKEN;
  if (raw === undefined) return null;
  if (/[\r\n\x00]/.test(raw)) {
    throw new Error("TANBOT_TELEGRAM_BOT_TOKEN must not contain CR, LF, or NUL characters.");
  }
  const trimmed = raw.trim();
  if (!trimmed.length) return null;
  if (!BOT_TOKEN_PATTERN.test(trimmed)) {
    throw new Error("TANBOT_TELEGRAM_BOT_TOKEN format is invalid.");
  }
  return trimmed;
}

function normalizeUsername(raw: string | undefined): string {
  const value = (raw?.trim() || DEFAULT_EXPECTED_BOT_USERNAME).replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(value)) {
    throw new Error("TANBOT_TELEGRAM_EXPECTED_USERNAME format is invalid.");
  }
  return value;
}

export function loadTanbotTelegramConfig(
  env: NodeJS.ProcessEnv = process.env,
): TanbotTelegramConfigLoadResult {
  if (!isTanbotTelegramEnabled(env)) {
    return { ok: false, message: "Tanbot Telegram integration is disabled." };
  }

  try {
    const botToken = readBotToken(env);
    if (!botToken) {
      return {
        ok: false,
        message: "TANBOT_TELEGRAM_BOT_TOKEN is required when TANBOT_TELEGRAM_ENABLED=true.",
      };
    }

    const requestTimeoutMs = parsePositiveInt(
      env.TANBOT_TELEGRAM_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      MIN_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    );
    if (requestTimeoutMs === null) {
      return {
        ok: false,
        message: `TANBOT_TELEGRAM_REQUEST_TIMEOUT_MS must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}.`,
      };
    }

    const maxResponseBytes = parsePositiveInt(
      env.TANBOT_TELEGRAM_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      MIN_MAX_RESPONSE_BYTES,
      MAX_MAX_RESPONSE_BYTES,
    );
    if (maxResponseBytes === null) {
      return {
        ok: false,
        message: `TANBOT_TELEGRAM_MAX_RESPONSE_BYTES must be an integer between ${MIN_MAX_RESPONSE_BYTES} and ${MAX_MAX_RESPONSE_BYTES}.`,
      };
    }

    const expectedUsername = normalizeUsername(env.TANBOT_TELEGRAM_EXPECTED_USERNAME);

    return {
      ok: true,
      config: {
        enabled: true,
        botToken,
        expectedUsername,
        requestTimeoutMs,
        maxResponseBytes,
      },
    };
  } catch {
    return { ok: false, message: SAFE_CONFIG_MESSAGE };
  }
}

export function describeTanbotTelegramConfigPresence(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  tokenPresent: boolean;
} {
  const enabled = isTanbotTelegramEnabled(env);
  const raw = env.TANBOT_TELEGRAM_BOT_TOKEN;
  const tokenPresent = typeof raw === "string" && raw.trim().length > 0;
  return { enabled, tokenPresent };
}
