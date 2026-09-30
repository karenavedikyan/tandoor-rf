import { SAFE_CONFIG_MESSAGE } from "./safe-errors";
import { buildPortalId, parseWebhookUrl } from "./url-security";
import type { Bitrix24ConfigLoadResult, Bitrix24WebhookConfig } from "./types";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const MIN_MAX_RESPONSE_BYTES = 16_384;
const MAX_MAX_RESPONSE_BYTES = 4_194_304;
const DEFAULT_MAX_PAGES = 20;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 100;
const DEFAULT_MAX_TOTAL_DURATION_MS = 60_000;
const MIN_MAX_TOTAL_DURATION_MS = 1_000;
const MAX_MAX_TOTAL_DURATION_MS = 300_000;

export function isBitrix24Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.BITRIX24_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (!raw?.trim()) {
    return fallback;
  }
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

export function loadBitrix24Config(env: NodeJS.ProcessEnv = process.env): Bitrix24ConfigLoadResult {
  if (!isBitrix24Enabled(env)) {
    return { ok: false, message: "Bitrix24 integration is disabled." };
  }

  const webhookUrl = env.BITRIX24_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return {
      ok: false,
      message: "BITRIX24_WEBHOOK_URL is required when BITRIX24_ENABLED=true.",
    };
  }

  try {
    const parsed = parseWebhookUrl(webhookUrl);
    const configuredPortalHost = env.BITRIX24_PORTAL_HOST?.trim().toLowerCase();
    if (configuredPortalHost && configuredPortalHost !== parsed.portalHost) {
      return {
        ok: false,
        message: "BITRIX24_PORTAL_HOST does not match the host in BITRIX24_WEBHOOK_URL.",
      };
    }

    const requestTimeoutMs = parsePositiveInt(
      env.BITRIX24_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      MIN_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    );
    if (requestTimeoutMs === null) {
      return {
        ok: false,
        message: `BITRIX24_REQUEST_TIMEOUT_MS must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}.`,
      };
    }

    const maxResponseBytes = parsePositiveInt(
      env.BITRIX24_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      MIN_MAX_RESPONSE_BYTES,
      MAX_MAX_RESPONSE_BYTES,
    );
    if (maxResponseBytes === null) {
      return {
        ok: false,
        message: `BITRIX24_MAX_RESPONSE_BYTES must be an integer between ${MIN_MAX_RESPONSE_BYTES} and ${MAX_MAX_RESPONSE_BYTES}.`,
      };
    }

    const maxPages = parsePositiveInt(
      env.BITRIX24_MAX_PAGES,
      DEFAULT_MAX_PAGES,
      MIN_MAX_PAGES,
      MAX_MAX_PAGES,
    );
    if (maxPages === null) {
      return {
        ok: false,
        message: `BITRIX24_MAX_PAGES must be an integer between ${MIN_MAX_PAGES} and ${MAX_MAX_PAGES}.`,
      };
    }

    const maxTotalDurationMs = parsePositiveInt(
      env.BITRIX24_MAX_TOTAL_DURATION_MS,
      DEFAULT_MAX_TOTAL_DURATION_MS,
      MIN_MAX_TOTAL_DURATION_MS,
      MAX_MAX_TOTAL_DURATION_MS,
    );
    if (maxTotalDurationMs === null) {
      return {
        ok: false,
        message: `BITRIX24_MAX_TOTAL_DURATION_MS must be an integer between ${MIN_MAX_TOTAL_DURATION_MS} and ${MAX_MAX_TOTAL_DURATION_MS}.`,
      };
    }

    const config: Bitrix24WebhookConfig = {
      enabled: true,
      portalHost: parsed.portalHost,
      portalId: buildPortalId(parsed.portalHost),
      webhookUserId: parsed.webhookUserId,
      webhookToken: parsed.webhookToken,
      webhookBaseUrl: parsed.webhookBaseUrl,
      requestTimeoutMs,
      maxResponseBytes,
      maxPages,
      maxTotalDurationMs,
    };

    return { ok: true, config };
  } catch {
    return { ok: false, message: SAFE_CONFIG_MESSAGE };
  }
}
