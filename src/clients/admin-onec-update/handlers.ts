import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { getAdminOnecUpdateStatus, startAdminOnecUpdate } from "./service";

export async function adminOnecUpdateStatusHandler(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const status = await getAdminOnecUpdateStatus();
  setNoStore(res);
  res.status(200).json(status);
}

export async function adminOnecUpdateStartHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser?.id) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }

  try {
    const started = await startAdminOnecUpdate({ requestedByUserId: req.authUser.id });
    setNoStore(res);
    res.status(202).json(started);
  } catch (error) {
    const isDuplicate =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "UPDATE_ALREADY_RUNNING";
    const message =
      error instanceof Error ? error.message : "Не удалось запустить обновление из 1С.";
    setNoStore(res);
    res
      .status(isDuplicate ? 409 : 503)
      .json(apiError(isDuplicate ? "UPDATE_ALREADY_RUNNING" : ERROR_CODES.SERVICE_UNAVAILABLE, message));
  }
}
