import type { NextFunction, Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AuthenticatedRequest } from "../middleware/auth";
import { apiError, ERROR_CODES } from "../shared/errors";
import { loadAccessContext } from "./context";
import { canReadClientsApi } from "./policy";
import { buildPreviewAccessContext } from "./preview";
import { getSessionPreviewUserId } from "./preview-service";
import type { AccessContext } from "./types";
import type { UserRole } from "../shared/user";

export type AccessRequest = AuthenticatedRequest & {
  accessContext?: AccessContext;
};

/** Role for business authorization and DTO shaping (never the actual admin auth identity). */
export function effectiveAccessRole(context: AccessContext | undefined, authRole?: string): string {
  if (context?.preview?.active) {
    return context.preview.targetUser.role;
  }
  return context?.role ?? authRole ?? "";
}

export function effectiveBusinessRole(req: AccessRequest): string {
  return effectiveAccessRole(req.accessContext, req.authUser?.role);
}

const ASSISTANT_WORK_FORBIDDEN =
  "На первом этапе ассистенту доступен только раздел «Клиенты».";

/** Blocks work hub / queue for effective assistant (real login or admin preview-as-assistant). */
export function requireNonAssistantBusinessRole(
  req: AccessRequest,
  res: Response,
  next: NextFunction,
): void {
  if (effectiveBusinessRole(req) === "assistant") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, ASSISTANT_WORK_FORBIDDEN));
    return;
  }
  next();
}

/** Standalone Sales section is not available to effective assistants. */
export function requireNonAssistantForSalesSection(
  req: AccessRequest,
  res: Response,
  next: NextFunction,
): void {
  if (effectiveBusinessRole(req) === "assistant") {
    setNoStore(res);
    res.status(403).json(
      apiError(ERROR_CODES.FORBIDDEN, "Раздел «Продажи» недоступен для роли ассистента на этом этапе."),
    );
    return;
  }
  next();
}

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
        req.sessionId,
      );
      if (!previewResult.ok) {
        setNoStore(res);
        res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, previewResult.message));
        return;
      }
      const targetRole = previewResult.context.preview!.targetUser.role as UserRole;
      req.accessContext = {
        ...previewResult.context,
        role: targetRole,
      };
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
  if (
    req.accessContext?.preview?.active &&
    req.accessContext.preview.readOnly &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())
  ) {
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
