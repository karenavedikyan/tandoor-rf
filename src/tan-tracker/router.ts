import express from "express";
import { attachAccessContext, blockPreviewWrites } from "../access/middleware";
import { requireAuth } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
import { getTanTrackerBootstrapHandler } from "./handlers";

export function createTanTrackerRouter(): express.Router {
  const router = express.Router();
  const readChain = [
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
  ] as const;
  const writeChain = [...readChain, blockPreviewWrites] as const;

  router.get("/bootstrap", ...readChain, (req, res, next) => {
    void getTanTrackerBootstrapHandler(req, res).catch(next);
  });

  // Placeholder for upcoming mutations (create/handoff/attachments) — wired with writeChain.
  router.post("/transfers", ...writeChain, (_req, res) => {
    res.status(501).json({ error: { code: "NOT_IMPLEMENTED", message: "Создание передачи — в работе (tt56 LK)." } });
  });

  return router;
}
