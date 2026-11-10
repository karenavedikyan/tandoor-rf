import type { RecoveryDelivery } from "./password-reset-service";
import { loadTanbotMaxStage2Config } from "../tanbot-max/stage2-config";
import { isTanbotMaxEnabled } from "../tanbot-max/config";
import { createDefaultMaxDeliveryTransport, type MaxDeliveryTransport } from "../tanbot-max/delivery-transport";
import { loadTanbotTelegramStage2Config } from "../tanbot-telegram/stage2-config";
import { isTanbotTelegramEnabled } from "../tanbot-telegram/config";
import { createDefaultTelegramDeliveryTransport, type TelegramDeliveryTransport } from "../tanbot-telegram/delivery-transport";

export function createRecoveryDelivery(overrides: {
  max?: MaxDeliveryTransport; telegram?: TelegramDeliveryTransport;
} = {}): RecoveryDelivery {
  return async input => {
    if (input.channel === "max") {
      const loaded = loadTanbotMaxStage2Config();
      if (!isTanbotMaxEnabled() || !loaded.ok || !loaded.config.deliveryEnabled) return false;
      const config = loaded.config;
      return (await (overrides.max ?? createDefaultMaxDeliveryTransport())({
        token: config.botToken, userId: BigInt(input.userId), text: input.text,
        timeoutMs: Math.min(config.requestTimeoutMs, 5000), maxResponseBytes: config.maxResponseBytes,
      })).ok;
    }
    const loaded = loadTanbotTelegramStage2Config();
    if (!isTanbotTelegramEnabled() || !loaded.ok || !loaded.config.deliveryEnabled) return false;
    const config = loaded.config;
    return (await (overrides.telegram ?? createDefaultTelegramDeliveryTransport())({
      method: "sendMessage", token: config.botToken,
      body: { chat_id: input.userId, text: input.text, disable_web_page_preview: true, protect_content: true },
      timeoutMs: Math.min(config.requestTimeoutMs, 5000), maxResponseBytes: config.maxResponseBytes,
    })).ok;
  };
}
