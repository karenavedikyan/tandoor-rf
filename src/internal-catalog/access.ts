import type { RequestHandler } from "express";
import { attachAccessContext, type AccessRequest } from "../access/middleware";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import { requireDatabaseReady } from "../middleware/database";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";

/** Admin pilot: the same server gate protects HTML, metadata, products and photos. */
export const internalCatalogAccess: RequestHandler[] = [
  (_req, res, next) => { setNoStore(res); next(); },
  requireDatabaseReady,
  requireAuth,
  requireAdmin,
  attachAccessContext,
  (req: AccessRequest, res, next) => {
    if (req.accessContext?.preview?.active || req.accessContext?.role !== "admin") {
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN,
        "Каталог доступен только администратору вне режима просмотра сотрудника."));
      return;
    }
    next();
  },
];
