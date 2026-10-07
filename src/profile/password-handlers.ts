import type { Response } from "express";
import { getPool } from "../db/pool";
import { changePasswordAtomically } from "../access/password-change-service";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import type { AuthenticatedRequest } from "../middleware/auth";

export async function changePasswordHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const body = req.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  const sessionId = req.sessionId;
  if (!sessionId) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }

  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(
      apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "База данных недоступна."),
    );
    return;
  }

  const result = await changePasswordAtomically(pool, {
    userId: req.authUser!.id,
    sessionId,
    currentPassword,
    newPassword,
  });

  if (!result.ok) {
    setNoStore(res);
    const status =
      result.code === "NOT_FOUND"
        ? 404
        : result.code === "INVALID_CREDENTIALS"
          ? 401
          : 400;
    res.status(status).json(apiError(result.code, result.message));
    return;
  }

  setNoStore(res);
  res.status(200).json({ user: result.user });
}
