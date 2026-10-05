import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { UNASSIGNED_CATEGORIES, type UnassignedCategory } from "../review/constants";
import { canUseUnassignedNavigation } from "../role-presentation";
import { buildUnassignedSummary } from "./repository";

export async function unassignedSummaryHandler(req: AccessRequest, res: Response): Promise<void> {
  const context = req.accessContext!;
  if (!canUseUnassignedNavigation(context)) {
    setNoStore(res);
    res.status(403).json(
      apiError(ERROR_CODES.FORBIDDEN, "Нераспределённые назначения недоступны для вашей роли."),
    );
    return;
  }

  let category: UnassignedCategory | undefined;
  const raw = typeof req.query.category === "string" ? req.query.category.trim() : "";
  if (raw) {
    if (!(UNASSIGNED_CATEGORIES as readonly string[]).includes(raw)) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректная категория."));
      return;
    }
    category = raw as UnassignedCategory;
  }

  const summary = await buildUnassignedSummary({ category });
  setNoStore(res);
  res.status(200).json(summary);
}
