import type { Response } from "express";
import type { AccessContext } from "../access/types";
import type { UserDto } from "../shared/user";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import type { AccessRequest } from "../access/middleware";
import { resolveTanTrackerEffectiveUser } from "./effective-user";
import { tanTrackerNavAllowed } from "./scope";

export function tanTrackerCanWrite(user: UserDto, access: AccessContext): boolean {
  if (access.preview?.readOnly) return false;
  if (user.role === "admin") return false;
  return tanTrackerNavAllowed(user.role);
}

export function rejectTanTrackerWrite(
  res: Response,
  message = "Раздел недоступен для этой роли.",
): void {
  setNoStore(res);
  res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, message));
}

/** Shared gate for every Tan-tracker mutation. */
export function requireTanTrackerMutationAccess(
  req: AccessRequest,
  res: Response,
): { user: UserDto; access: AccessContext } | null {
  if (!req.authUser || !req.accessContext) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return null;
  }
  const user = resolveTanTrackerEffectiveUser(req.authUser, req.accessContext);
  if (!tanTrackerCanWrite(user, req.accessContext)) {
    if (req.accessContext.preview?.readOnly) {
      rejectTanTrackerWrite(res, "Изменения запрещены в режиме просмотра.");
    } else {
      rejectTanTrackerWrite(res);
    }
    return null;
  }
  return { user, access: req.accessContext };
}
