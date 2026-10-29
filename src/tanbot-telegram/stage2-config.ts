import { SAFE_CONFIG_MESSAGE } from "./safe-errors";
import { loadTanbotTelegramConfig, isTanbotTelegramEnabled, DEFAULT_EXPECTED_BOT_USERNAME } from "./config";
import type { TanbotTelegramConfig } from "./types";

export const DEFAULT_LINK_TOKEN_TTL_MINUTES = 15;
export const MIN_LINK_TOKEN_TTL_MINUTES = 5;
export const MAX_LINK_TOKEN_TTL_MINUTES = 60;
export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 65_536;
export const TELEGRAM_START_PAYLOAD_MAX_LEN = 64;

export type TanbotTelegramStage2Config = TanbotTelegramConfig & {
  botUsername: string;
  linkTokenPepper: string;
  linkTokenTtlMinutes: number;
  webhookSecret: string | null;
  webhookEnabled: boolean;
  deliveryEnabled: boolean;
  appOrigin: string;
};

export function isTanbotTelegramWebhookEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_TELEGRAM_WEBHOOK_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function isTanbotTelegramDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_TELEGRAM_DELIVERY_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function parseTtlMinutes(raw: string | undefined): number | null {
  if (!raw?.trim()) return DEFAULT_LINK_TOKEN_TTL_MINUTES;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < MIN_LINK_TOKEN_TTL_MINUTES || value > MAX_LINK_TOKEN_TTL_MINUTES) {
    return null;
  }
  return value;
}

export function loadTanbotTelegramStage2Config(
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; config: TanbotTelegramStage2Config }
  | { ok: false; message: string } {
  const base = loadTanbotTelegramConfig(env);
  if (!base.ok) {
    return base;
  }

  try {
    const botUsername = (env.TANBOT_TELEGRAM_BOT_USERNAME?.trim() || base.config.expectedUsername).replace(
      /^@+/,
      "",
    );
    if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
      return { ok: false, message: SAFE_CONFIG_MESSAGE };
    }

    const pepper = env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER?.trim();
    if (!pepper || pepper.length < 16) {
      return {
        ok: false,
        message: "TANBOT_TELEGRAM_LINK_TOKEN_PEPPER must be at least 16 characters when Tanbot is enabled.",
      };
    }

    const linkTokenTtlMinutes = parseTtlMinutes(env.TANBOT_TELEGRAM_LINK_TOKEN_TTL_MINUTES);
    if (linkTokenTtlMinutes === null) {
      return {
        ok: false,
        message: `TANBOT_TELEGRAM_LINK_TOKEN_TTL_MINUTES must be an integer between ${MIN_LINK_TOKEN_TTL_MINUTES} and ${MAX_LINK_TOKEN_TTL_MINUTES}.`,
      };
    }

    const webhookEnabled = isTanbotTelegramWebhookEnabled(env);
    const webhookSecretRaw = env.TANBOT_TELEGRAM_WEBHOOK_SECRET?.trim();
    if (webhookEnabled && (!webhookSecretRaw || webhookSecretRaw.length < 16)) {
      return {
        ok: false,
        message: "TANBOT_TELEGRAM_WEBHOOK_SECRET (min 16 chars) is required when webhook is enabled.",
      };
    }

    const appOrigin = env.APP_ORIGIN?.trim();
    if (!appOrigin) {
      return { ok: false, message: "APP_ORIGIN is required for Tanbot Telegram links." };
    }

    return {
      ok: true,
      config: {
        ...base.config,
        botUsername,
        linkTokenPepper: pepper,
        linkTokenTtlMinutes,
        webhookSecret: webhookSecretRaw ?? null,
        webhookEnabled,
        deliveryEnabled: isTanbotTelegramDeliveryEnabled(env),
        appOrigin: appOrigin.replace(/\/+$/, ""),
      },
    };
  } catch {
    return { ok: false, message: SAFE_CONFIG_MESSAGE };
  }
}

export function describeTanbotStage2FeatureFlags(env: NodeJS.ProcessEnv = process.env): {
  integrationEnabled: boolean;
  webhookEnabled: boolean;
  deliveryEnabled: boolean;
  expectedBotUsername: string;
} {
  return {
    integrationEnabled: isTanbotTelegramEnabled(env),
    webhookEnabled: isTanbotTelegramWebhookEnabled(env),
    deliveryEnabled: isTanbotTelegramDeliveryEnabled(env),
    expectedBotUsername: (env.TANBOT_TELEGRAM_EXPECTED_USERNAME?.trim() || DEFAULT_EXPECTED_BOT_USERNAME).replace(
      /^@+/,
      "",
    ),
  };
}
