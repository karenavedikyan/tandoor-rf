import express from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import { requireDatabaseReady } from "../middleware/database";
import {
  clientOptionsHandler,
  clientSyncStatusHandler,
  getClientHandler,
  listClientsHandler,
} from "./handlers";

export function createClientsRouter(): express.Router {
  const router = express.Router();

  const adminChain = [requireDatabaseReady, requireAuth, requireAdmin] as const;

  router.get("/options", ...adminChain, (req, res, next) => {
    void clientOptionsHandler(req, res).catch(next);
  });

  router.get("/sync-status", ...adminChain, (req, res, next) => {
    void clientSyncStatusHandler(req, res).catch(next);
  });

  router.get("/", ...adminChain, (req, res, next) => {
    void listClientsHandler(req, res).catch(next);
  });

  router.get("/:guid", ...adminChain, (req, res, next) => {
    void getClientHandler(req, res).catch(next);
  });

  return router;
}
