import type { NextFunction, Request, Response } from "express";
import { parseSessionToken } from "../auth/cookie";
import { resolveSessionUser } from "../auth/session";
import { enforcePreviewBusinessPolicy } from "../access/preview-policy";
import type { UserDto } from "../shared/user";
import { apiError, ERROR_CODES } from "../shared/errors";
import { setNoStore } from "../http/no-store";
import { query } from "../db/pool";

const PASSWORD_CHANGE_EXEMPT_PATHS = [
  "/api/profile/change-password",
  "/api/profile/self",
  "/api/auth/logout",
  "/api/auth/me",
];

function isPasswordChangeExemptPath(path: string): boolean {
  return PASSWORD_CHANGE_EXEMPT_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export type AuthenticatedRequest = Request & {
  authUser?: UserDto;
  sessionId?: string;
};

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = parseSessionToken(req.headers.cookie);
  if (!token) {
    setNoStore(res);
    res.status(401).json(
      apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."),
    );
    return;
  }

  try {
    const session = await resolveSessionUser(token);
    if (!session) {
      setNoStore(res);
      res.status(401).json(
        apiError(ERROR_CODES.UNAUTHORIZED, "Сессия недействительна или истекла."),
      );
      return;
    }

    req.authUser = session.user;
    req.sessionId = session.sessionId;

    if (await enforcePreviewBusinessPolicy(req, res)) {
      return;
    }

    const requestPath = req.originalUrl.split("?")[0] ?? req.path;
    if (!isPasswordChangeExemptPath(requestPath)) {
      const mustChange = await query<{ password_must_change: boolean }>(
        `SELECT password_must_change FROM users WHERE id = $1::uuid`,
        [session.user.id],
      );
      if (mustChange.rows[0]?.password_must_change) {
        setNoStore(res);
        res.status(403).json(
          apiError(
            ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
            "Смените временный пароль перед продолжением работы.",
          ),
        );
        return;
      }
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
