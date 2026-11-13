import express from "express";
import { manualReport } from "../onec-manual/report";
import { csrfProtection } from "../middleware/csrf";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import { requireDatabaseReady } from "../middleware/database";
import {
  adminOnecUpdateConfigCheckHandler,
  adminOnecUpdateProbeHandler,
  adminOnecUpdateStartHandler,
  adminOnecUpdateStatusHandler,
} from "./admin-onec-update/handlers";

export function createAdminClientsRouter(): express.Router {
  const router = express.Router();
  const adminChain = [requireDatabaseReady, requireAuth, requireAdmin] as const;
  router.get("/onec-update/report", ...adminChain, (req, res, next) => { void manualReport(req, res).catch(next); });

  router.get("/onec-update/status", ...adminChain, (req, res, next) => {
    void adminOnecUpdateStatusHandler(req, res).catch(next);
  });

  router.get("/onec-update/config-check", ...adminChain, (req, res, next) => {
    void adminOnecUpdateConfigCheckHandler(req, res).catch(next);
  });

  router.post("/onec-update/probe", csrfProtection, ...adminChain, (req, res, next) => {
    void adminOnecUpdateProbeHandler(req, res).catch(next);
  });

  router.post("/onec-update", csrfProtection, ...adminChain, (req, res, next) => {
    void adminOnecUpdateStartHandler(req, res).catch(next);
  });

  return router;
}
