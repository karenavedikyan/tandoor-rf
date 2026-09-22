import type { NextFunction, Request, Response } from "express";
import { checkReadiness } from "../db/readiness";
import { getPool } from "../db/pool";
import { apiError, ERROR_CODES } from "../shared/errors";
import { setNoStore } from "../http/no-store";

export async function requireDatabaseReady(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!getPool()) {
    setNoStore(res);
    res.status(503).json(
      apiError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "Вход временно недоступен. База данных не настроена.",
      ),
    );
    return;
  }

  try {
    const readiness = await checkReadiness();
    if (!readiness.ready) {
      setNoStore(res);
      res.status(503).json(
        apiError(
          ERROR_CODES.SERVICE_UNAVAILABLE,
          readiness.reason === "schema_missing"
            ? "Вход временно недоступен. Схема базы данных не применена."
            : "Вход временно недоступен. База данных недоступна.",
        ),
      );
      return;
    }
    next();
  } catch {
    setNoStore(res);
    res.status(503).json(
      apiError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "Вход временно недоступен. База данных недоступна.",
      ),
    );
  }
}
