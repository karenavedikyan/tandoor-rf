import express from "express";
import type { Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
import { csrfProtection } from "../middleware/csrf";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "../clients/uuid-param";
import { AccessServiceError } from "./db";
import * as assignments from "./assignments";
import { searchAssistants } from "./service";
import { attachAccessContext, blockPreviewWrites, type AccessRequest } from "./middleware";
import { assignmentSchemaReady, prepareAssignmentSchema } from "./assignment-schema";
import { appointAssignmentCoordinator } from "./assignment-coordinator";
import * as reviews from "./assignment-reviews";

function uuid(value: unknown): string {
  if (typeof value !== "string" || !isValidUuidParam(value)) throw new AccessServiceError("Некорректный идентификатор.", "VALIDATION");
  return value.toLowerCase();
}
function page(value: unknown): number {
  const n = Number(value || 1);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) throw new AccessServiceError("Некорректная страница.", "VALIDATION");
  return n;
}
function str(value: unknown, max = 200): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > max) throw new AccessServiceError("Некорректный фильтр.", "VALIDATION");
  return value.trim();
}
function numeric(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  const v = str(value, 30);
  if (!/^-?\d{1,16}([.,]\d{1,4})?$/.test(v)) throw new AccessServiceError("Некорректная сумма.", "VALIDATION");
  return v.replace(",", ".");
}
function actor(req: AccessRequest) {
  return { id: req.accessContext?.userId ?? req.authUser!.id, role: req.accessContext?.role ?? req.authUser!.role };
}
type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
function handle(fn: Handler): express.RequestHandler {
  return (req, res, next) => {
    setNoStore(res);
    void (async () => {
      if (req.path !== "/assignments/schema" && !(await assignmentSchemaReady())) {
        res.status(503).json(apiError("SERVICE_UNAVAILABLE", "Раздел назначений ещё не подготовлен администратором. Клиентская база работает без изменений."));
        return;
      }
      await fn(req as AuthenticatedRequest, res);
    })().catch(error => {
      if (error instanceof AccessServiceError) {
        const status = { NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, VALIDATION: 400 }[error.code];
        res.status(status).json(apiError(error.code, error.message));
      } else next(error);
    });
  };
}
export function assignmentRouter(): express.Router {
  const router = express.Router();
  const auth = [requireDatabaseReady, requireAuth, attachAccessContext, blockPreviewWrites] as const;
  router.post("/assignments/schema", csrfProtection, ...auth, handle(async (req, res) => {
    res.json(await prepareAssignmentSchema(req.authUser!.id, req.body?.confirm));
  }));
  router.post("/assignments/coordinator", csrfProtection, ...auth, handle(async (req, res) => {
    res.json(await appointAssignmentCoordinator(req.authUser!.id, uuid(req.body?.userId),
      uuid(req.body?.employeeId), str(req.body?.basis, 2000) || "", req.body?.confirm));
  }));
  router.post("/assignments/reviews/schema", csrfProtection, ...auth, handle(async (req, res) => {
    res.json(await prepareAssignmentSchema(req.authUser!.id, req.body?.confirm, "051_assistant_assignment_reviews.sql"));
  }));
  const reviewsReady: express.RequestHandler = (_req, res, next) => {
    void reviews.reviewSchemaReady().then(ready => ready ? next() :
      res.status(503).json(apiError("SERVICE_UNAVAILABLE", "Оценки ещё не подготовлены администратором."))).catch(next);
  };
  router.get("/assignments/reviews", ...auth, reviewsReady, handle(async (req, res) => {
    const score = str(req.query.score, 4), status = str(req.query.status, 8);
    if (score && !/^[1-5]$|^low$/.test(score) || status && !["required", "rated"].includes(status)) {
      throw new AccessServiceError("Некорректный фильтр оценки.", "VALIDATION");
    }
    res.json(await reviews.listAssignmentReviews(actor(req), {
      page: page(req.query.page), q: str(req.query.q), score, status,
      assistantId: req.query.assistantId ? uuid(req.query.assistantId) : "",
      managerId: req.query.managerId ? uuid(req.query.managerId) : "",
    }));
  }));
  router.get("/delegations/:delegationId/review", ...auth, reviewsReady, handle(async (req, res) => {
    res.json({ review: await reviews.assignmentReview(actor(req), uuid(req.params.delegationId)) });
  }));
  router.post("/delegations/:delegationId/review", csrfProtection, ...auth, reviewsReady, handle(async (req, res) => {
    res.status(201).json(await reviews.submitAssignmentReview(actor(req), uuid(req.params.delegationId), req.body || {}));
  }));
  router.get("/assignments", ...auth, handle(async (req, res) => {
    res.json(await assignments.listAssignments(actor(req), { page: page(req.query.page), q: str(req.query.q), status: str(req.query.status) }));
  }));
  router.get("/overview", ...auth, handle(async (req, res) => {
    const data = await assignments.listAssignments(actor(req), { page: page(req.query.page), q: "", status: "" });
    res.json({ ...data, delegations: data.items });
  }));
  router.get("/assignments/activity", ...auth, handle(async (req, res) => {
    res.json(await assignments.assignmentActivity(actor(req), page(req.query.page), str(req.query.action), str(req.query.q)));
  }));
  router.get("/coordinator-managers", ...auth, handle(async (req, res) => {
    res.json({ managers: await assignments.assignmentManagers(actor(req)) });
  }));
  router.get("/assignments/assistants", ...auth, handle(async (req, res) => {
    if (!["manager", "coordinator"].includes(actor(req).role)) {
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Недостаточно прав.")); return;
    }
    res.json({ users: await searchAssistants(str(req.query.q), 100) });
  }));
  router.get("/delegators/:delegatorUserId/clients", ...auth, handle(async (req, res) => {
    const month = str(req.query.month, 7);
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AccessServiceError("Некорректный месяц.", "VALIDATION");
    const startsAt = str(req.query.startsAt, 40), endsAt = str(req.query.endsAt, 40);
    if (Boolean(startsAt) !== Boolean(endsAt) || startsAt && (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(startsAt) >= Date.parse(endsAt))) {
      throw new AccessServiceError("Укажите корректный период для проверки пересечений.", "VALIDATION");
    }
    if (req.query.conflict && (!startsAt || !endsAt)) throw new AccessServiceError("Для проверки пересечений укажите период.", "VALIDATION");
    const min = numeric(req.query.min), max = numeric(req.query.max);
    if (min !== undefined && max !== undefined && Number(min) > Number(max)) throw new AccessServiceError("Минимум больше максимума.", "VALIDATION");
    const legalMin = str(req.query.legalMin, 5);
    const retailMin = str(req.query.retailMin, 5);
    if (legalMin && !/^[1-9]\d{0,3}$/.test(legalMin)) throw new AccessServiceError("Некорректное количество юрлиц.", "VALIDATION");
    if (retailMin && !/^[1-9]\d{0,3}$/.test(retailMin)) throw new AccessServiceError("Некорректное количество торговых точек.", "VALIDATION");
    res.json(await assignments.assignmentPicker(actor(req), uuid(req.params.delegatorUserId), {
      page: page(req.query.page), q: str(req.query.q), city: str(req.query.city), category: str(req.query.category),
      month, min, max, legalMin, retailMin, conflict: str(req.query.conflict), sort: str(req.query.sort),
      startsAt, endsAt, excludeId: req.query.excludeId ? uuid(req.query.excludeId) : null,
    }));
  }));
  router.get("/delegations/:delegationId", ...auth, handle(async (req, res) => {
    res.json({ delegation: await assignments.assignmentDetail(actor(req), uuid(req.params.delegationId)) });
  }));
  router.post("/delegations", csrfProtection, ...auth, handle(async (req, res) => {
    if (!req.body || typeof req.body !== "object") throw new AccessServiceError("Ожидается заявка.", "VALIDATION");
    if (req.body.assistantUserId) uuid(req.body.assistantUserId);
    if (req.body.delegatorUserId) uuid(req.body.delegatorUserId);
    res.status(201).json(await assignments.writeAssignment(actor(req), "create", null, req.body));
  }));
  // Shadow every legacy mutation URL. No director/ROP/admin approval bypass.
  const actions: Record<string, string> = {
    edit: "edit", submit: "submit", approve: "approve", reject: "reject", return: "return",
    cancel: "cancel", revoke: "revoke", "change-requests": "propose_change",
    "approve-change": "approve_change", "reject-change": "reject_change",
    "return-change": "return_change", "cancel-change": "cancel_change",
  };
  for (const [route, action] of Object.entries(actions)) {
    router.post("/delegations/:delegationId/" + route, csrfProtection, ...auth, handle(async (req, res) => {
      if (req.body?.assistantUserId) uuid(req.body.assistantUserId);
      const result = await assignments.writeAssignment(actor(req), action, uuid(req.params.delegationId), req.body || {});
      res.json(result);
    }));
  }
  router.post("/delegations/change-requests/:changeRequestId/approve", csrfProtection, ...auth, handle(async (_req, res) => {
    res.status(409).json(apiError("CONFLICT", "Обновите назначение и согласуйте изменения из его карточки."));
  }));
  router.get("/notifications", ...auth, handle(async (req, res) => {
    if (req.query.unread !== undefined && req.query.unread !== "1") throw new AccessServiceError("Некорректный фильтр уведомлений.", "VALIDATION");
    res.json(await assignments.assignmentNotifications(actor(req), page(req.query.page), req.query.unread === "1",
      Boolean((req as AccessRequest).accessContext?.preview?.active)));
  }));
  router.post("/notifications/read-all", csrfProtection, ...auth, handle(async (req, res) => {
    await assignments.readAssignmentNotifications(actor(req)); res.json({ ok: true });
  }));
  router.post("/notifications/:id/read", csrfProtection, ...auth, handle(async (req, res) => {
    await assignments.readAssignmentNotifications(actor(req), uuid(req.params.id)); res.json({ ok: true });
  }));
  return router;
}
