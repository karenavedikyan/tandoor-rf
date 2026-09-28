import type { NextFunction, Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AuthenticatedRequest } from "../middleware/auth";
import { apiError, ERROR_CODES } from "../shared/errors";
import type { UserRole } from "../shared/user";

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const role = req.authUser?.role;
    if (!role || !roles.includes(role)) {
      setNoStore(res);
      res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Недостаточно прав."));
      return;
    }
    next();
  };
}

export function requireAnyRole(roles: UserRole[]) {
  return requireRoles(...roles);
}
