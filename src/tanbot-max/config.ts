import { SAFE_CONFIG_MESSAGE } from "./safe-errors";
import { readMaxTlsCaBundle } from "./tls-fetch";
import type { TanbotMaxConfig, TanbotMaxConfigLoadResult } from "./types";

export const DEFAULT_EXPECTED_BOT_USERNAME = "id231100522180_bot";
export const MAX_API_ORIGIN = "https://platform-api2.max.ru";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 65_536;
const MIN_MAX_RESPONSE_BYTES = 4_096;
const MAX_MAX_RESPONSE_BYTES = 262_144;

/** MAX bot nicknames (not numeric user_id). */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,64}$/;

/** Server-side token: printable ASCII, no whitespace; not Telegram `id:hash` shape required. */
const BOT_TOKEN_PATTERN = /^[\x21-\x7E]{8,512}$/;

export function isTanbotMaxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_MAX_ENABLED?.trim().toLowerCase();
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
  const raw = env.TANBOT_MAX_BOT_TOKEN;
  if (raw === undefined) return null;
  if (/[\r\n\x00\s]/.test(raw)) {
    throw new Error("TANBOT_MAX_BOT_TOKEN must not contain whitespace or control characters.");
  }
  const trimmed = raw.trim();
  if (!trimmed.length) return null;
  if (!BOT_TOKEN_PATTERN.test(trimmed)) {
    throw new Error("TANBOT_MAX_BOT_TOKEN format is invalid.");
  }
  return trimmed;
}

function normalizeUsername(raw: string | undefined): string {
  const value = (raw?.trim() || DEFAULT_EXPECTED_BOT_USERNAME).replace(/^@+/, "");
  if (!USERNAME_PATTERN.test(value)) {
    throw new Error("TANBOT_MAX_EXPECTED_USERNAME format is invalid.");
  }
  return value;
}

export function loadTanbotMaxConfig(env: NodeJS.ProcessEnv = process.env): TanbotMaxConfigLoadResult {
  if (!isTanbotMaxEnabled(env)) {
    return { ok: false, message: "Tanbot MAX integration is disabled." };
  }

  try {
    const botToken = readBotToken(env);
    if (!botToken) {
      return {
        ok: false,
        message: "TANBOT_MAX_BOT_TOKEN is required when TANBOT_MAX_ENABLED=true.",
      };
    }

    const requestTimeoutMs = parsePositiveInt(
      env.TANBOT_MAX_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      MIN_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    );
    if (requestTimeoutMs === null) {
      return {
        ok: false,
        message: `TANBOT_MAX_REQUEST_TIMEOUT_MS must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}.`,
      };
    }

    const maxResponseBytes = parsePositiveInt(
      env.TANBOT_MAX_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      MIN_MAX_RESPONSE_BYTES,
      MAX_MAX_RESPONSE_BYTES,
    );
    if (maxResponseBytes === null) {
      return {
        ok: false,
        message: `TANBOT_MAX_MAX_RESPONSE_BYTES must be an integer between ${MIN_MAX_RESPONSE_BYTES} and ${MAX_MAX_RESPONSE_BYTES}.`,
      };
    }

    const expectedUsername = normalizeUsername(env.TANBOT_MAX_EXPECTED_USERNAME);
    const tlsPath = env.TANBOT_MAX_TLS_CA_BUNDLE?.trim() || null;
    if (tlsPath) {
      readMaxTlsCaBundle(env);
    }

    return {
      ok: true,
      config: {
        enabled: true,
        botToken,
        expectedUsername,
        requestTimeoutMs,
        maxResponseBytes,
        tlsCaBundlePath: tlsPath,
      },
    };
  } catch {
    return { ok: false, message: SAFE_CONFIG_MESSAGE };
  }
}

export function describeTanbotMaxConfigPresence(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  tokenPresent: boolean;
  tlsCaBundleConfigured: boolean;
} {
  const enabled = isTanbotMaxEnabled(env);
  const raw = env.TANBOT_MAX_BOT_TOKEN;
  const tokenPresent = typeof raw === "string" && raw.trim().length > 0;
  const tlsCaBundleConfigured = Boolean(env.TANBOT_MAX_TLS_CA_BUNDLE?.trim());
  return { enabled, tokenPresent, tlsCaBundleConfigured };
}
