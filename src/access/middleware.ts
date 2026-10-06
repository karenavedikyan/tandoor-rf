import type { NextFunction, Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AuthenticatedRequest } from "../middleware/auth";
import { apiError, ERROR_CODES } from "../shared/errors";
import { loadAccessContext } from "./context";
import { canReadClientsApi } from "./policy";
import { buildPreviewAccessContext } from "./preview";
import { getSessionPreviewUserId } from "./preview-service";
import type { AccessContext } from "./types";

export type AccessRequest = AuthenticatedRequest & {
  accessContext?: AccessContext;
};

export async function attachAccessContext(
  req: AccessRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.authUser) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }

  try {
    const previewUserId =
      req.authUser.role === "admin" && req.sessionId
        ? await getSessionPreviewUserId(req.sessionId)
        : null;

    if (previewUserId) {
      const previewResult = await buildPreviewAccessContext(
        req.authUser.id,
        previewUserId,
        loadAccessContext,
      );
      if (!previewResult.ok) {
        setNoStore(res);
        res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, previewResult.message));
        return;
      }
      req.accessContext = previewResult.context;
      next();
      return;
    }

    req.accessContext = await loadAccessContext(req.authUser.id, req.authUser.role);
    next();
  } catch {
    setNoStore(res);
    res.status(503).json(
      apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Проверка доступа временно недоступна."),
    );
  }
}

export function blockPreviewWrites(
  req: AccessRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.accessContext?.preview?.active) {
    setNoStore(res);
    res.status(403).json(
      apiError(ERROR_CODES.FORBIDDEN, "Изменения запрещены в режиме просмотра от имени сотрудника."),
    );
    return;
  }
  next();
}

export function requireClientReadAccess(
  req: AccessRequest,
  res: Response,
  next: NextFunction,
): void {
  const context = req.accessContext;
  if (!context) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }

  if (!canReadClientsApi(context)) {
    setNoStore(res);
    res.status(403).json(
      apiError(ERROR_CODES.FORBIDDEN, "Нет доступа к разделу «Клиенты»."),
    );
    return;
  }

  next();
}
