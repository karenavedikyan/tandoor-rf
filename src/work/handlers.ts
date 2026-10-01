import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { parseWorkListQuery } from "./query";
import { listWorkQueueForUser } from "./service";

export async function getWorkQueueHandler(req: AccessRequest, res: Response): Promise<void> {
  const parsed = parseWorkListQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, parsed.message));
    return;
  }

  const context = req.accessContext!;
  try {
    const result = await listWorkQueueForUser({
      context,
      query: parsed.query,
      actorDisplayName: req.authUser?.fullName ?? "Сотрудник",
    });
    setNoStore(res);
    res.status(200).json(result);
  } catch {
    setNoStore(res);
    res.status(503).json(
      apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось загрузить очередь работы."),
    );
  }
}
