import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { isValidUuidParam } from "../uuid-param";
import { listTeamManagers, listTeamRops, TeamAccessError } from "./repository";

function sendTeamError(res: Response, error: TeamAccessError): void {
  setNoStore(res);
  if (error.code === "FORBIDDEN") {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, error.message));
    return;
  }
  res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, error.message));
}

export async function listTeamRopsHandler(req: AccessRequest, res: Response): Promise<void> {
  const context = req.accessContext!;
  if (context.role !== "admin" && context.role !== "rop" && !context.fullClientBase) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нет доступа к командам продаж."));
    return;
  }

  try {
    const items = await listTeamRops(context);
    setNoStore(res);
    res.status(200).json({ items });
  } catch (error) {
    if (error instanceof TeamAccessError) {
      sendTeamError(res, error);
      return;
    }
    throw error;
  }
}

export async function listTeamManagersHandler(req: AccessRequest, res: Response): Promise<void> {
  const ropUserId = typeof req.params.ropUserId === "string" ? req.params.ropUserId.trim() : "";
  if (!isValidUuidParam(ropUserId)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный идентификатор РОП."));
    return;
  }

  try {
    const items = await listTeamManagers(req.accessContext!, ropUserId.toLowerCase());
    setNoStore(res);
    res.status(200).json({ items });
  } catch (error) {
    if (error instanceof TeamAccessError) {
      sendTeamError(res, error);
      return;
    }
    throw error;
  }
}
