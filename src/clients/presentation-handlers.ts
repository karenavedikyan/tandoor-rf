import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { loadAssistantDelegationContext } from "./delegation-context";
import { resolveRolePresentation } from "./role-presentation";

export async function clientsPresentationHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const context = req.accessContext!;
  const presentation = resolveRolePresentation(context);
  if (!presentation) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Нет доступа к разделу клиентов."));
    return;
  }

  if (presentation.businessRole === "assistant") {
    try {
      presentation.delegationContext = await loadAssistantDelegationContext(context);
    } catch {
      presentation.delegationContext = null;
    }
  }

  setNoStore(res);
  res.status(200).json({ presentation });
}
