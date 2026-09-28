import express from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import { requireDatabaseReady } from "../middleware/database";
import { csrfProtection } from "../middleware/csrf";
import {
  accessExplainHandler,
  accessOverviewHandler,
  approveDelegationHandler,
  createDelegationHandler,
  createEmployeeLinkHandler,
  createGrantHandler,
  createRopTeamHandler,
  revokeDelegationHandler,
} from "./admin-handlers";

export function createAccessAdminRouter(): express.Router {
  const router = express.Router();
  const chain = [requireDatabaseReady, requireAuth, requireAdmin] as const;

  router.get("/overview", ...chain, (req, res, next) => {
    void accessOverviewHandler(req, res).catch(next);
  });

  router.get("/explain", ...chain, (req, res, next) => {
    void accessExplainHandler(req, res).catch(next);
  });

  router.post("/employee-links", csrfProtection, ...chain, (req, res, next) => {
    void createEmployeeLinkHandler(req, res).catch(next);
  });

  router.post("/grants", csrfProtection, ...chain, (req, res, next) => {
    void createGrantHandler(req, res).catch(next);
  });

  router.post("/rop-teams", csrfProtection, ...chain, (req, res, next) => {
    void createRopTeamHandler(req, res).catch(next);
  });

  router.post("/delegations", csrfProtection, ...chain, (req, res, next) => {
    void createDelegationHandler(req, res).catch(next);
  });

  router.post(
    "/delegations/:delegationId/approve",
    csrfProtection,
    ...chain,
    (req, res, next) => {
      void approveDelegationHandler(req, res).catch(next);
    },
  );

  router.post(
    "/delegations/:delegationId/revoke",
    csrfProtection,
    ...chain,
    (req, res, next) => {
      void revokeDelegationHandler(req, res).catch(next);
    },
  );

  return router;
}
