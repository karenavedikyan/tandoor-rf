import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import {
  getAdminOnecConfigCheck,
  getAdminOnecUpdateStatus,
  runAdminOnecUpdateProbe,
  startAdminOnecUpdate,
} from "./service";

export async function adminOnecUpdateStatusHandler(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const status = await getAdminOnecUpdateStatus();
  setNoStore(res);
  res.status(200).json(status);
}

export async function adminOnecUpdateConfigCheckHandler(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const payload = await getAdminOnecConfigCheck();
  setNoStore(res);
  res.status(200).json(payload);
}

export async function adminOnecUpdateProbeHandler(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const payload = await runAdminOnecUpdateProbe();
  setNoStore(res);
  res.status(payload.ok ? 200 : 409).json(payload);
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
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    const existingJobId =
      error !== null && typeof error === "object" && "existingJobId" in error
        ? (error as { existingJobId?: string }).existingJobId
        : undefined;
    const conflictCodes = new Set(["UPDATE_ALREADY_RUNNING", "APPLY_BLOCKED", "IMPORT_RUNNING"]);
    const isConflict = code != null && conflictCodes.has(code);
    const message =
      error instanceof Error ? error.message : "Не удалось запустить обновление из 1С.";
    setNoStore(res);
    res.status(isConflict ? 409 : 503).json({
      ...apiError(isConflict ? (code ?? "UPDATE_ALREADY_RUNNING") : ERROR_CODES.SERVICE_UNAVAILABLE, message),
      ...(existingJobId ? { jobId: existingJobId } : {}),
    });
  }
}
