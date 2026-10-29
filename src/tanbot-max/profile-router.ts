import { Router, type Request, type Response, type NextFunction } from "express";
import { getPool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { csrfProtection } from "../middleware/csrf";
import { requireDatabaseReady } from "../middleware/database";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { attachAccessContext, blockPreviewWrites, type AccessRequest } from "../access/middleware";
import { isTanbotMaxEnabled } from "./config";
import { describeTanbotMaxStage2FeatureFlags, loadTanbotMaxStage2Config } from "./stage2-config";
import {
  confirmTanbotMaxLink,
  disconnectTanbotMaxLink,
  getTanbotMaxLinkStatus,
  setTanbotMaxNotificationsEnabled,
  startTanbotMaxLink,
} from "./link-service";

function handle(fn: (req: AccessRequest, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req as AccessRequest, res).catch(next);
  };
}

export function createTanbotMaxProfileRouter(): Router {
  const router = Router();

  router.get(
    "/max",
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    handle(async (req, res) => {
      setNoStore(res);
      const flags = describeTanbotMaxStage2FeatureFlags();
      if (!flags.integrationEnabled) {
        res.status(200).json({
          integrationEnabled: false,
          linked: false,
          notificationsEnabled: false,
          botUsername: flags.expectedBotUsername,
        });
        return;
      }
      const loaded = loadTanbotMaxStage2Config();
      if (!loaded.ok) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "MAX временно недоступен."));
        return;
      }
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      const status = await getTanbotMaxLinkStatus(pool, req.authUser!.id, loaded.config.botUsername, {
        integrationEnabled: true,
      });
      res.status(200).json(status);
    }),
  );

  router.post(
    "/max/link/start",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    handle(async (req, res) => {
      setNoStore(res);
      if (!isTanbotMaxEnabled()) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Интеграция MAX отключена."));
        return;
      }
      const loaded = loadTanbotMaxStage2Config();
      if (!loaded.ok) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "MAX временно недоступен."));
        return;
      }
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      try {
        const result = await startTanbotMaxLink(pool, loaded.config, req.authUser!.id);
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
    "/max/link/confirm",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    handle(async (req, res) => {
      setNoStore(res);
      if (!isTanbotMaxEnabled()) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Интеграция MAX отключена."));
        return;
      }
      const loaded = loadTanbotMaxStage2Config();
      if (!loaded.ok) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "MAX временно недоступен."));
        return;
      }
      const attemptId = String((req.body as { attemptId?: string })?.attemptId ?? "").trim();
      const enableNotifications = (req.body as { enableNotifications?: boolean })?.enableNotifications === true;
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
        const result = await confirmTanbotMaxLink(pool, req.authUser!.id, attemptId, { enableNotifications });
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
    "/max/disconnect",
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
      await disconnectTanbotMaxLink(pool, req.authUser!.id);
      res.status(200).json({ ok: true });
    }),
  );

  router.post(
    "/max/notifications",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    handle(async (req, res) => {
      setNoStore(res);
      const enabled = (req.body as { enabled?: boolean })?.enabled === true;
      if (enabled && !isTanbotMaxEnabled()) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Интеграция MAX отключена."));
        return;
      }
      const pool = getPool();
      if (!pool) {
        res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."));
        return;
      }
      try {
        await setTanbotMaxNotificationsEnabled(pool, req.authUser!.id, enabled);
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
