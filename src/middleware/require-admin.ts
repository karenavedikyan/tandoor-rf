import type { NextFunction, Response } from "express";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import type { AuthenticatedRequest } from "./auth";

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.authUser?.role !== "admin") {
    setNoStore(res);
    res.status(403).json(
      apiError(ERROR_CODES.FORBIDDEN, "Раздел доступен только администратору."),
    );
    return;
  }
  next();
}
