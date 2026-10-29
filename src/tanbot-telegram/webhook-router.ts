import express, { type Request, type Response, type NextFunction } from "express";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import {
  isTanbotTelegramWebhookEnabled,
  loadTanbotTelegramStage2Config,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "./stage2-config";
import { handleTanbotTelegramUpdate, maybeSendWebhookReply } from "./webhook-handler";
import { createDefaultTelegramDeliveryTransport } from "./delivery-transport";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function webhookBodyTooLarge(req: Request): boolean {
  const len = req.header("content-length");
  if (!len) return false;
  const n = Number(len);
  return Number.isFinite(n) && n > DEFAULT_WEBHOOK_MAX_BODY_BYTES;
}

export function createTanbotTelegramWebhookRouter(): express.Router {
  const router = express.Router();

  router.post("/", (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      setNoStore(res);
      if (!isTanbotTelegramWebhookEnabled()) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (webhookBodyTooLarge(req)) {
        res.status(413).json({ error: "Payload too large" });
        return;
      }
      const loaded = loadTanbotTelegramStage2Config();
      if (!loaded.ok || !loaded.config.webhookSecret) {
        res.status(503).json({ error: "Service unavailable" });
        return;
      }
      const header = req.header("x-telegram-bot-api-secret-token") ?? "";
      if (!constantTimeEqual(header, loaded.config.webhookSecret)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const raw = req.body;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Service unavailable" });
        return;
      }

      const transport = loaded.config.deliveryEnabled ? createDefaultTelegramDeliveryTransport() : null;
      const { reply, updateId } = await handleTanbotTelegramUpdate(pool, loaded.config, raw);
      await maybeSendWebhookReply(pool, loaded.config, transport, updateId, reply);
      res.status(200).json({ ok: true });
    })().catch(next);
  });

  return router;
}
