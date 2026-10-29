import type { Pool } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport } from "./delivery-transport";
import { createDefaultTelegramDeliveryTransport } from "./delivery-transport";
import { processTanbotNotificationOutbox } from "./outbox-worker";
import { isTanbotTelegramDeliveryEnabled } from "./stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "./reply-retry";

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
