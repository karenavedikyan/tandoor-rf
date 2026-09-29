import express from "express";
import {
  attachAccessContext,
  requireClientReadAccess,
} from "../access/middleware";
import { requireAuth } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
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

  router.get("/:guid", ...readChain, (req, res, next) => {
    void getClientHandler(req, res).catch(next);
  });

  return router;
}
