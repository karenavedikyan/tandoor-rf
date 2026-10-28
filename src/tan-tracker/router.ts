import express from "express";
import { attachAccessContext, blockPreviewWrites } from "../access/middleware";
import { requireAuth } from "../middleware/auth";
import { csrfProtection } from "../middleware/csrf";
import { requireDatabaseReady } from "../middleware/database";
import { getTanTrackerBootstrapHandler } from "./handlers";
import { generateHandoffCodeHandler, verifyHandoffCodeHandler } from "./handoff-mutations";
import { createTransferHandler } from "./mutations";
import { cancelPendingHandler, changePendingHandler } from "./pending-mutations";
import { downloadAttachmentHandler } from "./attachments";

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

  router.get("/transfers/:id/attachments/:attId", ...readChain, (req, res, next) => {
    void downloadAttachmentHandler(req, res).catch(next);
  });

  // Placeholder for upcoming mutations (create/handoff/attachments) — wired with writeChain.
  router.post("/transfers", csrfProtection, ...writeChain, (req, res, next) => {
    void createTransferHandler(req, res).catch(next);
  });

  router.post("/transfers/:id/code/generate", csrfProtection, ...writeChain, (req, res, next) => {
    void generateHandoffCodeHandler(req, res).catch(next);
  });

  router.post("/transfers/:id/code/verify", csrfProtection, ...writeChain, (req, res, next) => {
    void verifyHandoffCodeHandler(req, res).catch(next);
  });

  router.post("/transfers/:id/pending/cancel", csrfProtection, ...writeChain, (req, res, next) => {
    void cancelPendingHandler(req, res).catch(next);
  });

  router.post("/transfers/:id/pending/change", csrfProtection, ...writeChain, (req, res, next) => {
    void changePendingHandler(req, res).catch(next);
  });

  return router;
}
