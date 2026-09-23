import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AuthenticatedRequest } from "../middleware/auth";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "./uuid-param";
import { parseClientsListQuery } from "./query";
import {
  countAllClients,
  getClientByGuid,
  getClientOptions,
  getClientsSyncStatus,
  listClients,
} from "./repository";

function sendValidationError(res: Response, message: string): void {
  setNoStore(res);
  res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
}

export async function listClientsHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = parseClientsListQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    sendValidationError(res, parsed.message);
    return;
  }

  const result = await listClients(parsed.query);
  const hasFilters = Boolean(
    parsed.query.q ||
      parsed.query.managerId ||
      parsed.query.holdingId ||
      parsed.query.phone !== "all",
  );
  if (!hasFilters && result.total === 0) {
    result.isEmptyDatabase = (await countAllClients()) === 0;
  }

  setNoStore(res);
  res.status(200).json(result);
}

export async function clientOptionsHandler(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const options = await getClientOptions();
  setNoStore(res);
  res.status(200).json(options);
}

export async function clientSyncStatusHandler(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const status = await getClientsSyncStatus();
  setNoStore(res);
  res.status(200).json(status);
}

export async function getClientHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const guid = typeof req.params.guid === "string" ? req.params.guid.trim() : "";
  if (!isValidUuidParam(guid)) {
    sendValidationError(res, "Некорректный идентификатор клиента.");
    return;
  }

  const client = await getClientByGuid(guid.toLowerCase());
  setNoStore(res);
  if (!client) {
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Клиент не найден."));
    return;
  }

  res.status(200).json({ client });
}
