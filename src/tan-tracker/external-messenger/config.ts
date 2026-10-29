import { isTanTrackerUserTestEnv } from "../../shared/tan-tracker-user-test-env";
import { isTanbotMaxEnabled } from "../../tanbot-max/config";
import { isTanbotTelegramEnabled } from "../../tanbot-telegram/config";
import { requireHandoffOtpPepper } from "../otp-config";

export const EXTERNAL_MESSENGER_START_PREFIX = "er";
export const EXTERNAL_MESSENGER_START_TOKEN_LEN = 43;
export const EXTERNAL_MESSENGER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EXTERNAL_MESSENGER_MAX_CONTACT_ATTEMPTS = 8;
export const EXTERNAL_MESSENGER_MAX_CODE_ISSUES = 3;

export function isExternalMessengerFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isTanTrackerUserTestEnv(env)) {
    return env.TT_EXTERNAL_MESSENGER_IN_USER_TEST?.trim().toLowerCase() === "true";
  }
  const raw = env.TT_EXTERNAL_MESSENGER_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function externalMessengerTokenPepper(): string {
  return requireHandoffOtpPepper();
}

export type MessengerChannelAvailability = {
  channel: "telegram" | "max";
  available: boolean;
  reason: string | null;
  deepLink: string | null;
};

export function resolveMessengerChannelAvailability(
  env: NodeJS.ProcessEnv = process.env,
): Omit<MessengerChannelAvailability, "deepLink">[] {
  const telegramConfigured = isTanbotTelegramEnabled(env);
  const maxConfigured = isTanbotMaxEnabled(env);
  const feature = isExternalMessengerFeatureEnabled(env);
  return [
    {
      channel: "telegram",
      available: feature && telegramConfigured,
      reason: !feature
        ? "Подтверждение через мессенджеры недоступно."
        : !telegramConfigured
          ? "Telegram не настроен на сервере."
          : null,
    },
    {
      channel: "max",
      available: feature && maxConfigured,
      reason: !feature
        ? "Подтверждение через мессенджеры недоступно."
        : !maxConfigured
          ? "MAX пока не подключён. Выберите Telegram или дождитесь настройки MAX."
          : null,
    },
  ];
}
