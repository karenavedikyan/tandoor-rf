import type { NextFunction, Request, Response } from "express";
import { getAppOrigin } from "../config";
import { apiError, ERROR_CODES } from "../shared/errors";
import { setNoStore } from "../http/no-store";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function rejectCsrf(req: Request, res: Response, next: NextFunction, requireJson: boolean): boolean {
  const appOrigin = getAppOrigin();
  if (!appOrigin) {
    setNoStore(res);
    res.status(503).json(
      apiError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "Сервис временно недоступен. Настройте APP_ORIGIN.",
      ),
    );
    return false;
  }

  const originHeader = req.headers.origin;
  if (typeof originHeader !== "string" || !originHeader.trim()) {
    setNoStore(res);
    res.status(403).json(
      apiError(ERROR_CODES.CSRF_REJECTED, "Запрос отклонён из соображений безопасности."),
    );
    return false;
  }

  if (normalizeOrigin(originHeader) !== normalizeOrigin(appOrigin)) {
    setNoStore(res);
    res.status(403).json(
      apiError(ERROR_CODES.CSRF_REJECTED, "Запрос отклонён из соображений безопасности."),
    );
    return false;
  }

  if (requireJson) {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      setNoStore(res);
      res.status(415).json(
        apiError(
          ERROR_CODES.INVALID_CONTENT_TYPE,
          "Ожидается Content-Type: application/json.",
        ),
      );
      return false;
    }
  }

  return true;
}

/** Origin check only — for raw/binary uploads that are not JSON bodies. */
export function csrfOriginProtection(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  if (rejectCsrf(req, res, next, false)) next();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  if (rejectCsrf(req, res, next, true)) next();
}
