import express from "express";
import { csrfProtection } from "../middleware/csrf";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import { requireDatabaseReady } from "../middleware/database";
import {
  adminOnecUpdateStartHandler,
  adminOnecUpdateStatusHandler,
} from "./admin-onec-update/handlers";

export function createAdminClientsRouter(): express.Router {
  const router = express.Router();
  const adminChain = [requireDatabaseReady, requireAuth, requireAdmin] as const;

  router.get("/onec-update/status", ...adminChain, (req, res, next) => {
    void adminOnecUpdateStatusHandler(req, res).catch(next);
  });

  router.post("/onec-update", csrfProtection, ...adminChain, (req, res, next) => {
    void adminOnecUpdateStartHandler(req, res).catch(next);
  });

  return router;
}
