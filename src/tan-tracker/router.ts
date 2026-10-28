import express from "express";
import { attachAccessContext, blockPreviewWrites } from "../access/middleware";
import { requireAuth } from "../middleware/auth";
import { csrfOriginProtection, csrfProtection } from "../middleware/csrf";
import { requireDatabaseReady } from "../middleware/database";
import { getTanTrackerBootstrapHandler } from "./handlers";
import { generateHandoffCodeHandler, verifyHandoffCodeHandler } from "./handoff-mutations";
import { createTransferHandler } from "./mutations";
import { cancelPendingHandler, changePendingHandler } from "./pending-mutations";
import { downloadAttachmentHandler } from "./attachments";
import { addTransferAttachmentsHandler, deleteTransferAttachmentHandler } from "./attachment-mutations";
import {
  publicConfirmQrHandoffHandler,
  publicSendPhoneCodeHandler,
  publicVerifyPhoneCodeHandler,
} from "./public-recipient";
import {
  publicRecipientAttachmentHandler,
  publicRecipientContextHandler,
} from "./public-recipient-context";
export function createTanTrackerRouter(): express.Router {
  const router = express.Router();
  const readChain = [
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
  ] as const;
  const writeChain = [...readChain, blockPreviewWrites] as const;

  router.post("/public/recipient/phone/send", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicSendPhoneCodeHandler(req, res).catch(next);
  });
  router.post("/public/recipient/phone/verify", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicVerifyPhoneCodeHandler(req, res).catch(next);
  });
  router.post("/public/recipient/handoff/qr-confirm", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicConfirmQrHandoffHandler(req, res).catch(next);
  });

  router.get("/public/recipient/context", requireDatabaseReady, (req, res, next) => {
    void publicRecipientContextHandler(req, res).catch(next);
  });

  router.get("/public/recipient/attachments/:attId", requireDatabaseReady, (req, res, next) => {
    void publicRecipientAttachmentHandler(req, res).catch(next);
  });

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

  router.post("/transfers/:id/attachments", csrfProtection, ...writeChain, (req, res, next) => {
    void addTransferAttachmentsHandler(req, res).catch(next);
  });

  router.delete("/transfers/:id/attachments/:attId", csrfProtection, ...writeChain, (req, res, next) => {
    void deleteTransferAttachmentHandler(req, res).catch(next);
  });

  return router;
}
