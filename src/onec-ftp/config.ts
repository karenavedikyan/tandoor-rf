import type { OnecFtpConfig, OnecFtpSecurityMode } from "./types";

const DEFAULT_PORT = 21;
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export type OnecFtpConfigLoadResult =
  | { ok: true; config: OnecFtpConfig }
  | { ok: false; message: string };

export function isOnecFtpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ONEC_FTP_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function readTrimmedRequired(
  env: NodeJS.ProcessEnv,
  key: string,
  label: string,
): string | null {
  const raw = env[key];
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  assertNoControlChars(trimmed, label);
  return trimmed;
}

function readPasswordRequired(env: NodeJS.ProcessEnv): string | null {
  const raw = env.ONEC_FTP_PASSWORD;
  if (raw === undefined || raw.length === 0) {
    return null;
  }
  assertNoControlChars(raw, "ONEC_FTP_PASSWORD");
  return raw;
}

export function assertNoControlChars(value: string, label: string): void {
  if (/[\r\n\x00]/.test(value)) {
    throw new Error(`${label} must not contain CR, LF, or NUL characters.`);
  }
}

export function assertSafeFtpPath(basePath: string): void {
  assertNoControlChars(basePath, "ONEC_FTP_BASE_PATH");
  if (!basePath.startsWith("/")) {
    throw new Error("ONEC_FTP_BASE_PATH must be an absolute FTP path starting with '/'.");
  }
  if (basePath.includes("..")) {
    throw new Error("ONEC_FTP_BASE_PATH must not contain '..'.");
  }
}

function parsePort(env: NodeJS.ProcessEnv): number | null {
  const raw = env.ONEC_FTP_PORT?.trim();
  if (!raw) {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return null;
  }
  return port;
}

function parseSecurityMode(env: NodeJS.ProcessEnv): OnecFtpSecurityMode | null {
  const raw = env.ONEC_FTP_SECURITY?.trim().toLowerCase();
  if (!raw || raw === "plain") {
    return "plain";
  }
  return null;
}

function parseTimeoutMs(env: NodeJS.ProcessEnv): number | null {
  const raw = env.ONEC_FTP_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    return null;
  }
  return timeoutMs;
}

export function loadOnecFtpConfig(env: NodeJS.ProcessEnv = process.env): OnecFtpConfigLoadResult {
  if (!isOnecFtpEnabled(env)) {
    return { ok: false, message: "1C FTP integration is disabled." };
  }

  try {
    const host = readTrimmedRequired(env, "ONEC_FTP_HOST", "ONEC_FTP_HOST");
    const user = readTrimmedRequired(env, "ONEC_FTP_USER", "ONEC_FTP_USER");
    const password = readPasswordRequired(env);
    const basePath = readTrimmedRequired(env, "ONEC_FTP_BASE_PATH", "ONEC_FTP_BASE_PATH");
    const port = parsePort(env);
    const timeoutMs = parseTimeoutMs(env);
    const security = parseSecurityMode(env);

    if (!host) {
      return { ok: false, message: "ONEC_FTP_HOST is required when ONEC_FTP_ENABLED=true." };
    }
    if (!user) {
      return { ok: false, message: "ONEC_FTP_USER is required when ONEC_FTP_ENABLED=true." };
    }
    if (password === null) {
      return { ok: false, message: "ONEC_FTP_PASSWORD is required when ONEC_FTP_ENABLED=true." };
    }
    if (!basePath) {
      return { ok: false, message: "ONEC_FTP_BASE_PATH is required when ONEC_FTP_ENABLED=true." };
    }
    if (port === null) {
      return {
        ok: false,
        message: `ONEC_FTP_PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
      };
    }
    if (timeoutMs === null) {
      return {
        ok: false,
        message: `ONEC_FTP_TIMEOUT_MS must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`,
      };
    }
    if (security === null) {
      return {
        ok: false,
        message: "ONEC_FTP_SECURITY must be 'plain'.",
      };
    }

    assertSafeFtpPath(basePath);

    return {
      ok: true,
      config: {
        enabled: true,
        security,
        host,
        port,
        user,
        password,
        basePath,
        timeoutMs,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid 1C FTP configuration.";
    return { ok: false, message };
  }
}
