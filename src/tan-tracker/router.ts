import express from "express";
import { attachAccessContext, blockPreviewWrites } from "../access/middleware";
import { requireAuth } from "../middleware/auth";
import { csrfOriginProtection, csrfProtection } from "../middleware/csrf";
import { requireDatabaseReady } from "../middleware/database";
import { getTanTrackerBootstrapHandler } from "./handlers";
import { generateHandoffCodeHandler, verifyHandoffCodeHandler } from "./handoff-mutations";
import { createTransferHandler } from "./mutations";
import { cancelPendingHandler, changePendingHandler } from "./pending-mutations";
import { editTransferDraftHandler } from "./draft-edit-mutations";
import { downloadAttachmentHandler } from "./attachments";
import { addTransferAttachmentsHandler, deleteTransferAttachmentHandler } from "./attachment-mutations";
import {
  publicConfirmQrHandoffHandler,
  publicRecipientCodeGenerateHandler,
  publicSendPhoneCodeHandler,
  publicVerifyPhoneCodeHandler,
} from "./public-recipient";
import {
  publicHolderAddAttachmentsHandler,
  publicHolderAttachmentHandler,
  publicHolderChangePendingHandler,
  publicHolderContextHandler,
  publicHolderDeleteAttachmentHandler,
  publicHolderSendToFinalHandler,
  publicHolderVerifyCodeHandler,
} from "./public-holder";
import { legacyCompleteHandler } from "./legacy-complete-mutation";
import {
  publicRecipientAttachmentHandler,
  publicRecipientContextHandler,
  publicRecipientReceiptHandler,
} from "./public-recipient-context";
import { publicExternalMessengerPortalHandler } from "./external-messenger/public-handlers";
import { createExternalMessengerInviteHandler } from "./external-messenger/lk-handlers";
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

  router.post("/public/recipient/code/generate", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicRecipientCodeGenerateHandler(req, res).catch(next);
  });

  router.get("/public/holder/context", requireDatabaseReady, (req, res, next) => {
    void publicHolderContextHandler(req, res).catch(next);
  });

  router.post("/public/holder/send-to-final", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicHolderSendToFinalHandler(req, res).catch(next);
  });

  router.post("/public/holder/code/verify", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicHolderVerifyCodeHandler(req, res).catch(next);
  });

  router.get("/public/holder/attachments/:attId", requireDatabaseReady, (req, res, next) => {
    void publicHolderAttachmentHandler(req, res).catch(next);
  });

  router.post("/public/holder/pending/change", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicHolderChangePendingHandler(req, res).catch(next);
  });

  router.post("/public/holder/attachments", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicHolderAddAttachmentsHandler(req, res).catch(next);
  });

  router.delete("/public/holder/attachments/:attId", csrfOriginProtection, requireDatabaseReady, (req, res, next) => {
    void publicHolderDeleteAttachmentHandler(req, res).catch(next);
  });

  router.get("/public/recipient/messenger", requireDatabaseReady, (req, res, next) => {
    void publicExternalMessengerPortalHandler(req, res).catch(next);
  });

  router.get("/public/recipient/context", requireDatabaseReady, (req, res, next) => {
    void publicRecipientContextHandler(req, res).catch(next);
  });

  router.get("/public/recipient/receipt", requireDatabaseReady, (req, res, next) => {
    void publicRecipientReceiptHandler(req, res).catch(next);
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

  router.post("/transfers/:id/messenger-invite", csrfProtection, ...writeChain, (req, res, next) => {
    void createExternalMessengerInviteHandler(req, res).catch(next);
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

  router.post("/transfers/:id/draft-edit", csrfProtection, ...writeChain, (req, res, next) => {
    void editTransferDraftHandler(req, res).catch(next);
  });

  router.post("/transfers/:id/legacy-complete", csrfProtection, ...writeChain, (req, res, next) => {
    void legacyCompleteHandler(req, res).catch(next);
  });

  router.post("/transfers/:id/attachments", csrfProtection, ...writeChain, (req, res, next) => {
    void addTransferAttachmentsHandler(req, res).catch(next);
  });

  router.delete("/transfers/:id/attachments/:attId", csrfProtection, ...writeChain, (req, res, next) => {
    void deleteTransferAttachmentHandler(req, res).catch(next);
  });

  return router;
}
