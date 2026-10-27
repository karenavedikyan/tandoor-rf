import express from "express";
import {
  attachAccessContext,
  requireClientReadAccess,
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
  ] as const;

  router.get("/tasks", ...readChain, (req, res, next) => {
    if ((req as import("../middleware/auth").AuthenticatedRequest).authUser?.role === "assistant") {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "На первом этапе ассистенту доступен только раздел «Клиенты»." } });
      return;
    }
    void getWorkQueueHandler(req, res).catch(next);
  });

  return router;
}
