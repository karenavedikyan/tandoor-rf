import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { buildTanTrackerBootstrap } from "./service";
import { tanTrackerNavAllowed } from "./scope";

export async function getTanTrackerBootstrapHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  if (!req.authUser || !req.accessContext) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }
  if (!tanTrackerNavAllowed(req.authUser.role)) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Раздел недоступен для этой роли."));
    return;
  }
  const payload = await buildTanTrackerBootstrap(req.authUser, req.accessContext);
  setNoStore(res);
  res.status(200).json(payload);
}
