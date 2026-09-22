import type { NextFunction, Request, Response } from "express";
import { parseSessionToken } from "../auth/cookie";
import { resolveSessionUser } from "../auth/session";
import type { UserDto } from "../shared/user";
import { apiError, ERROR_CODES } from "../shared/errors";
import { setNoStore } from "../http/no-store";

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
