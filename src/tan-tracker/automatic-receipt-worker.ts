import type { Pool } from "pg";
import {
  processAutomaticReceiptCodes,
  type AutomaticReceiptTransport,
} from "./automatic-receipt-codes";
import {
  loadTanbotTelegramStage2Config,
  isTanbotTelegramDeliveryEnabled,
} from "../tanbot-telegram/stage2-config";
import {
  loadTanbotMaxStage2Config,
  isTanbotMaxDeliveryEnabled,
} from "../tanbot-max/stage2-config";
import { createDefaultTelegramDeliveryTransport } from "../tanbot-telegram/delivery-transport";
import { createDefaultMaxDeliveryTransport } from "../tanbot-max/delivery-transport";
import {
  withMaxMainMenuButton,
  MAX_MAIN_MENU_CALLBACK,
} from "../tanbot-max/main-menu-button";
import { isExternalMessengerFeatureEnabled } from "./external-messenger/config";

/** Only this new queue. Never activate legacy notification workers or replay old tracks. */
export function startAutomaticReceiptWorker(pool: Pool): { stop: () => void } {
  if (!isExternalMessengerFeatureEnabled()) return { stop: () => undefined };
  const telegram = loadTanbotTelegramStage2Config(),
    max = loadTanbotMaxStage2Config();
  const tgTransport = createDefaultTelegramDeliveryTransport(),
    maxTransport = createDefaultMaxDeliveryTransport();
  let ticking = false,
    stopped = false;
  const transport: AutomaticReceiptTransport = async (msg) => {
    if (msg.channel === "telegram" && telegram.ok) {
      const result = await tgTransport({
        method: "sendMessage",
        token: telegram.config.botToken,
        timeoutMs: telegram.config.requestTimeoutMs,
        maxResponseBytes: telegram.config.maxResponseBytes,
        body: {
          chat_id: msg.chatId,
          text: msg.text,
          disable_web_page_preview: true,
          ...(msg.callback
            ? {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Получить новый код",
                        callback_data: msg.callback,
                      },
                    ],
                    [
                      {
                        text: "Главное меню",
                        callback_data: MAX_MAIN_MENU_CALLBACK,
                      },
                    ],
                  ],
                },
              }
            : {}),
        },
      });
      return result.ok
        ? { ok: true }
        : {
            ok: false,
            code: result.code,
            retryable: result.retryable,
            retryAfterSeconds: result.retryAfterSeconds,
          };
    }
    if (msg.channel === "max" && max.ok) {
      const result = await maxTransport({
        token: max.config.botToken,
        userId: BigInt(msg.userId),
        text: msg.text,
        timeoutMs: max.config.requestTimeoutMs,
        maxResponseBytes: max.config.maxResponseBytes,
        ...(msg.callback
          ? {
              inlineButtons: withMaxMainMenuButton([
                [
                  {
                    type: "callback",
                    text: "Получить новый код",
                    payload: msg.callback,
                  },
                ],
              ]),
            }
          : {}),
      });
      return result.ok
        ? { ok: true }
        : {
            ok: false,
            code: result.code,
            retryable: result.retryable,
            retryAfterSeconds: result.retryAfterSeconds,
          };
    }
    return { ok: false, code: "CHANNEL_UNAVAILABLE" };
  };
  const timer = setInterval(() => {
    if (ticking || stopped) return;
    ticking = true;
    void (async () => {
      if (
        telegram.ok &&
        telegram.config.webhookEnabled &&
        isTanbotTelegramDeliveryEnabled()
      )
        await processAutomaticReceiptCodes(pool, {
          channel: "telegram",
          transport,
          deliveryEnabled: true,
        });
      if (max.ok && max.config.webhookEnabled && isTanbotMaxDeliveryEnabled())
        await processAutomaticReceiptCodes(pool, {
          channel: "max",
          transport,
          deliveryEnabled: true,
        });
    })()
      .catch(() => console.error("Automatic receipt delivery tick failed"))
      .finally(() => {
        ticking = false;
      });
  }, 15_000);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
