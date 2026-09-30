import express from "express";
import {
  attachAccessContext,
  requireClientReadAccess,
} from "../access/middleware";
import { csrfProtection } from "../middleware/csrf";
import { requireAuth } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
import {
  getClientBitrix24LabelHandler,
  getClientBitrix24TasksHandler,
  postClientBitrix24LabelHandler,
  putClientBitrix24TaskContactHandler,
} from "./bitrix24-handlers";
import {
  clientOptionsHandler,
  clientSyncStatusHandler,
  getClientHandler,
  listClientsHandler,
} from "./handlers";

export function createClientsRouter(): express.Router {
  const router = express.Router();

  const readChain = [
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    requireClientReadAccess,
  ] as const;

  router.get("/sync-status", ...readChain, (req, res, next) => {
    void clientSyncStatusHandler(req, res).catch(next);
  });

  router.get("/options", ...readChain, (req, res, next) => {
    void clientOptionsHandler(req, res).catch(next);
  });

  router.get("/", ...readChain, (req, res, next) => {
    void listClientsHandler(req, res).catch(next);
  });

  router.get("/:guid/bitrix24/label", ...readChain, (req, res, next) => {
    void getClientBitrix24LabelHandler(req, res).catch(next);
  });

  router.post("/:guid/bitrix24/label", csrfProtection, ...readChain, (req, res, next) => {
    void postClientBitrix24LabelHandler(req, res).catch(next);
  });

  router.get("/:guid/bitrix24/tasks", ...readChain, (req, res, next) => {
    void getClientBitrix24TasksHandler(req, res).catch(next);
  });

  router.put("/:guid/bitrix24/tasks/:taskId/contact", csrfProtection, ...readChain, (req, res, next) => {
    void putClientBitrix24TaskContactHandler(req, res).catch(next);
  });

  router.get("/:guid", ...readChain, (req, res, next) => {
    void getClientHandler(req, res).catch(next);
  });

  return router;
}
