import express from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import { requireDatabaseReady } from "../middleware/database";
import { csrfProtection } from "../middleware/csrf";
import { setNoStore } from "../http/no-store";
import { AccessServiceError } from "./db";
import { stageEmployeeRollout, rolloutStatus, applyEmployeeRollout, cancelEmployeeRollout } from "./employee-rollout";
import { initializeEmployeeRolloutSchema } from "./employee-rollout-schema";
export function employeeRolloutRouter() {
  const router = express.Router();
  router.use(requireDatabaseReady, requireAuth, requireAdmin);
  const handle = (fn: (req: AuthenticatedRequest) => Promise<unknown>) =>
    async (req: AuthenticatedRequest, res: express.Response) => {
      setNoStore(res);
      res.set("Pragma", "no-cache");
      try { res.json(await fn(req)); }
      catch (error) {
        if (error instanceof AccessServiceError)
          res.status(error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400)
            .json({ error: { code: error.code, message: error.message } });
        else {
          if (process.env.NODE_ENV === "test") {
            const diagnostic = error as { code?: string; constraint?: string };
            console.error("Rollout database failure", diagnostic.code, diagnostic.constraint);
          }
          res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE",
            message: "Выдача недоступна. Проверьте состояние операции перед повтором." } });
        }
      }
    };
  router.post("/schema", csrfProtection,
    handle(req => initializeEmployeeRolloutSchema(req.authUser!.id, req.body?.confirm)));
  router.post("/", csrfProtection, handle(req => stageEmployeeRollout(req.authUser!.id, req.body)));
  router.get("/:id", handle(req => rolloutStatus(req.authUser!.id, String(req.params.id))));
  router.post("/:id/activate", csrfProtection,
    handle(req => applyEmployeeRollout(req.authUser!.id, String(req.params.id), req.body?.receipt)));
  router.post("/:id/cancel", csrfProtection,
    handle(req => cancelEmployeeRollout(req.authUser!.id, String(req.params.id))));
  return router;
}
