import type { Pool } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport } from "./delivery-transport";
import { createDefaultMaxDeliveryTransport } from "./delivery-transport";
import { processTanbotMaxNotificationOutbox } from "./outbox-worker";
import { isTanbotMaxDeliveryEnabled } from "./stage2-config";
import { processUndeliveredMaxWebhookReplies } from "./reply-retry";
import { processExternalPersonMessageOutbox } from "../tan-tracker/external-person/outbox-worker";

const DEFAULT_INTERVAL_MS = 15_000;

export function isTanbotMaxOutboxWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANBOT_MAX_OUTBOX_WORKER_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export async function runTanbotMaxOutboxWorkerOnce(
  pool: Pool,
  config: TanbotMaxStage2Config,
  transport?: MaxDeliveryTransport,
): Promise<void> {
  const deliveryTransport = transport ?? createDefaultMaxDeliveryTransport();
  const deliveryEnabled = isTanbotMaxDeliveryEnabled();
  await processTanbotMaxNotificationOutbox(pool, config, deliveryTransport, {
    deliveryEnabled,
  });
  await processUndeliveredMaxWebhookReplies(pool, config, deliveryTransport, { deliveryEnabled });
  await processExternalPersonMessageOutbox(pool, {
    channel: "max",
    botToken: config.botToken,
    requestTimeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    deliveryEnabled,
    transport: async ({ chatId, text, botToken, timeoutMs, maxResponseBytes }) => {
      const send = await deliveryTransport({
        token: botToken,
        userId: BigInt(chatId),
        text,
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

export function startTanbotMaxOutboxWorker(
  pool: Pool,
  config: TanbotMaxStage2Config,
  transport?: MaxDeliveryTransport,
): { stop: () => void } {
  let stopped = false;
  let ticking = false;
  const intervalMs = Number(process.env.TANBOT_MAX_OUTBOX_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const timer = setInterval(() => {
    if (stopped || ticking) return;
    ticking = true;
    void runTanbotMaxOutboxWorkerOnce(pool, config, transport)
      .catch((err) => {
        console.error("Tanbot MAX outbox worker tick failed:", err instanceof Error ? err.message : err);
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
