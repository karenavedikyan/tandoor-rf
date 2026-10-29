import { Router, type Request, type Response, type NextFunction } from "express";
import { getPool } from "../db/pool";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { csrfProtection } from "../middleware/csrf";
import { requireDatabaseReady } from "../middleware/database";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { attachAccessContext, blockPreviewWrites, type AccessRequest } from "../access/middleware";
import { isTanbotTelegramEnabled } from "./config";
import { describeTanbotStage2FeatureFlags, loadTanbotTelegramStage2Config } from "./stage2-config";
import {
  confirmTanbotLink,
  disconnectTanbotLink,
  getTanbotLinkStatus,
  setTanbotNotificationsEnabled,
  startTanbotLink,
} from "./link-service";

function handle(fn: (req: AccessRequest, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req as AccessRequest, res).catch(next);
  };
}

export function createTanbotTelegramProfileRouter(): Router {
  const router = Router();

  router.get(
    "/telegram",
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    handle(async (req, res) => {
      setNoStore(res);
      const flags = describeTanbotStage2FeatureFlags();
      if (!flags.integrationEnabled) {
        res.status(200).json({
          integrationEnabled: false,
          linked: false,
          notificationsEnabled: false,
          botUsername: flags.expectedBotUsername,
        });
        return;
      }
      const loaded = loadTanbotTelegramStage2Config();
      if (!loaded.ok) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Telegram временно недоступен."));
        return;
      }
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      const status = await getTanbotLinkStatus(pool, req.authUser!.id, loaded.config.botUsername);
      res.status(200).json(status);
    }),
  );

  router.post(
    "/telegram/link/start",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    handle(async (req, res) => {
      setNoStore(res);
      if (!isTanbotTelegramEnabled()) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Интеграция Telegram отключена."));
        return;
      }
      const loaded = loadTanbotTelegramStage2Config();
      if (!loaded.ok) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Telegram временно недоступен."));
        return;
      }
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      try {
        const result = await startTanbotLink(pool, loaded.config, req.authUser!.id);
        res.status(200).json(result);
      } catch (err: unknown) {
        const http = (err as { http?: number }).http ?? 503;
        const message = err instanceof Error ? err.message : "Не удалось начать привязку.";
        res
          .status(http)
          .json(apiError(http === 409 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.SERVICE_UNAVAILABLE, message));
      }
    }),
  );

  router.post(
    "/telegram/link/confirm",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    handle(async (req, res) => {
      setNoStore(res);
      const attemptId = String((req.body as { attemptId?: string })?.attemptId ?? "").trim();
      if (!attemptId) {
        res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "attemptId обязателен."));
        return;
      }
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      try {
        const result = await confirmTanbotLink(pool, req.authUser!.id, attemptId);
        res.status(200).json(result);
      } catch (err: unknown) {
        const http = (err as { http?: number }).http ?? 503;
        const message = err instanceof Error ? err.message : "Не удалось подтвердить привязку.";
        res
          .status(http)
          .json(
            apiError(
              http === 404
                ? ERROR_CODES.NOT_FOUND
                : http === 409
                  ? ERROR_CODES.VALIDATION_ERROR
                  : ERROR_CODES.SERVICE_UNAVAILABLE,
              message,
            ),
          );
      }
    }),
  );

  router.post(
    "/telegram/disconnect",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    handle(async (req, res) => {
      setNoStore(res);
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      await disconnectTanbotLink(pool, req.authUser!.id);
      res.status(200).json({ ok: true });
    }),
  );

  router.post(
    "/telegram/notifications",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    handle(async (req, res) => {
      setNoStore(res);
      const enabled = (req.body as { enabled?: boolean })?.enabled === true;
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      try {
        await setTanbotNotificationsEnabled(pool, req.authUser!.id, enabled);
        res.status(200).json({ ok: true, enabled });
      } catch (err: unknown) {
        const http = (err as { http?: number }).http ?? 503;
        const message = err instanceof Error ? err.message : "Не удалось обновить настройку.";
        res
          .status(http)
          .json(apiError(http === 409 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.SERVICE_UNAVAILABLE, message));
      }
    }),
  );

  return router;
}
