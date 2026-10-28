import express from "express";
import {
  attachAccessContext,
  requireClientReadAccess,
  requireNonAssistantBusinessRole,
  type AccessRequest,
} from "../access/middleware";
import { requireAuth } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
import { getWorkQueueHandler } from "./handlers";

export function createWorkRouter(): express.Router {
  const router = express.Router();
  const readChain = [
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    requireClientReadAccess,
    requireNonAssistantBusinessRole,
  ] as const;

  router.get("/tasks", ...readChain, (req, res, next) => {
    void getWorkQueueHandler(req as AccessRequest, res).catch(next);
  });

  return router;
}
