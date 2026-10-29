import { SAFE_CONFIG_MESSAGE } from "./safe-errors";
import { loadTanbotMaxConfig, isTanbotMaxEnabled, DEFAULT_EXPECTED_BOT_USERNAME } from "./config";
import type { TanbotMaxConfig } from "./types";

export const DEFAULT_LINK_TOKEN_TTL_MINUTES = 15;
export const MIN_LINK_TOKEN_TTL_MINUTES = 5;
export const MAX_LINK_TOKEN_TTL_MINUTES = 60;
export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 65_536;
export const MAX_START_PAYLOAD_MAX_LEN = 128;

export type TanbotMaxStage2Config = TanbotMaxConfig & {
  botUsername: string;
  linkTokenPepper: string;
  linkTokenTtlMinutes: number;
  webhookSecret: string | null;
  webhookEnabled: boolean;
  deliveryEnabled: boolean;
  appOrigin: string;
};

export function isTanbotMaxWebhookEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_MAX_WEBHOOK_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function isTanbotMaxDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_MAX_DELIVERY_ENABLED?.trim().toLowerCase();
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

export function loadTanbotMaxStage2Config(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: TanbotMaxStage2Config } | { ok: false; message: string } {
  const base = loadTanbotMaxConfig(env);
  if (!base.ok) {
    return base;
  }

  try {
    const botUsername = (env.TANBOT_MAX_BOT_USERNAME?.trim() || base.config.expectedUsername).replace(/^@+/, "");
    if (!/^[A-Za-z0-9_]{3,64}$/.test(botUsername)) {
      return { ok: false, message: SAFE_CONFIG_MESSAGE };
    }

    const pepper = env.TANBOT_MAX_LINK_TOKEN_PEPPER?.trim();
    if (!pepper || pepper.length < 16) {
      return {
        ok: false,
        message: "TANBOT_MAX_LINK_TOKEN_PEPPER must be at least 16 characters when Tanbot MAX is enabled.",
      };
    }

    const linkTokenTtlMinutes = parseTtlMinutes(env.TANBOT_MAX_LINK_TOKEN_TTL_MINUTES);
    if (linkTokenTtlMinutes === null) {
      return {
        ok: false,
        message: `TANBOT_MAX_LINK_TOKEN_TTL_MINUTES must be an integer between ${MIN_LINK_TOKEN_TTL_MINUTES} and ${MAX_LINK_TOKEN_TTL_MINUTES}.`,
      };
    }

    const webhookEnabled = isTanbotMaxWebhookEnabled(env);
    const webhookSecretRaw = env.TANBOT_MAX_WEBHOOK_SECRET?.trim();
    if (webhookEnabled && (!webhookSecretRaw || webhookSecretRaw.length < 16)) {
      return {
        ok: false,
        message: "TANBOT_MAX_WEBHOOK_SECRET (min 16 chars) is required when webhook is enabled.",
      };
    }

    const appOrigin = env.APP_ORIGIN?.trim();
    if (!appOrigin) {
      return { ok: false, message: "APP_ORIGIN is required for Tanbot MAX links." };
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
        deliveryEnabled: isTanbotMaxDeliveryEnabled(env),
        appOrigin: appOrigin.replace(/\/+$/, ""),
      },
    };
  } catch {
    return { ok: false, message: SAFE_CONFIG_MESSAGE };
  }
}

export function describeTanbotMaxStage2FeatureFlags(env: NodeJS.ProcessEnv = process.env): {
  integrationEnabled: boolean;
  webhookEnabled: boolean;
  deliveryEnabled: boolean;
  expectedBotUsername: string;
} {
  return {
    integrationEnabled: isTanbotMaxEnabled(env),
    webhookEnabled: isTanbotMaxWebhookEnabled(env),
    deliveryEnabled: isTanbotMaxDeliveryEnabled(env),
    expectedBotUsername: (env.TANBOT_MAX_EXPECTED_USERNAME?.trim() || DEFAULT_EXPECTED_BOT_USERNAME).replace(
      /^@+/,
      "",
    ),
  };
}
