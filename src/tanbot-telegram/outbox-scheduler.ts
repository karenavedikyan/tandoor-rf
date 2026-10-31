import type { Pool } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport } from "./delivery-transport";
import { createDefaultTelegramDeliveryTransport } from "./delivery-transport";
import { processTanbotNotificationOutbox } from "./outbox-worker";
import { isTanbotTelegramDeliveryEnabled } from "./stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "./reply-retry";
import { processExternalPersonMessageOutbox } from "../tan-tracker/external-person/outbox-worker";
import { buildTelegramExternalPersonOutboxPresentation } from "../tan-tracker/external-person/telegram-outbox-presentation";

const DEFAULT_INTERVAL_MS = 15_000;

export function isTanbotTelegramOutboxWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export async function runTanbotOutboxWorkerOnce(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  transport?: TelegramDeliveryTransport,
): Promise<void> {
  const deliveryTransport = transport ?? createDefaultTelegramDeliveryTransport();
  const deliveryEnabled = isTanbotTelegramDeliveryEnabled();
  await processTanbotNotificationOutbox(pool, config, deliveryTransport, {
    deliveryEnabled,
  });
  await processUndeliveredTelegramWebhookReplies(pool, config, deliveryTransport, { deliveryEnabled });
  await processExternalPersonMessageOutbox(pool, {
    channel: "telegram",
    botToken: config.botToken,
    requestTimeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    deliveryEnabled,
    transport: async ({ chatId, messengerUserId: _messengerUserId, text, botToken, timeoutMs, maxResponseBytes }) => {
      const appOrigin = config.appOrigin || process.env.APP_ORIGIN || "";
      const presentation = buildTelegramExternalPersonOutboxPresentation(text, appOrigin);
      const body: Record<string, unknown> =
        presentation.mode === "rich"
          ? {
              chat_id: chatId,
              text: presentation.text,
              reply_markup: presentation.replyMarkup,
              link_preview_options: presentation.linkPreviewOptions,
            }
          : {
              chat_id: chatId,
              text: presentation.text,
              disable_web_page_preview: presentation.disableWebPagePreview,
            };
      const send = await deliveryTransport({
        method: "sendMessage",
        token: botToken,
        body,
        timeoutMs,
        maxResponseBytes,
      });
      if (send.ok) return { ok: true };
      return {
        ok: false,
        code: send.code,
        retryable: send.retryable,
        retryAfterSeconds: send.retryAfterSeconds,
      };
    },
  });
}

export function startTanbotTelegramOutboxWorker(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  transport?: TelegramDeliveryTransport,
): { stop: () => void } {
  let stopped = false;
  let ticking = false;
  const intervalMs = Number(process.env.TANBOT_TELEGRAM_OUTBOX_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const timer = setInterval(() => {
    if (stopped || ticking) return;
    ticking = true;
    void runTanbotOutboxWorkerOnce(pool, config, transport)
      .catch((err) => {
        console.error("Tanbot outbox worker tick failed:", err instanceof Error ? err.message : err);
      })
      .finally(() => {
        ticking = false;
      });
  }, Number.isFinite(intervalMs) && intervalMs >= 5000 ? intervalMs : DEFAULT_INTERVAL_MS);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
