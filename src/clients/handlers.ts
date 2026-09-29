import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { loadScheduledExchangeConfig } from "../onec-scheduled-exchange/config";
import { setNoStore } from "../http/no-store";
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
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const context = req.accessContext!;
  const parsed = parseClientsListQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    sendValidationError(res, parsed.message);
    return;
  }

  const result = await listClients(context, parsed.query);
  const hasFilters = Boolean(
    parsed.query.q ||
      parsed.query.managerId ||
      parsed.query.holdingId ||
      parsed.query.phone !== "all",
  );
  if (!hasFilters && result.total === 0 && context.fullClientBase) {
    result.isEmptyDatabase = (await countAllClients()) === 0;
  }

  setNoStore(res);
  res.status(200).json(result);
}

export async function clientOptionsHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const options = await getClientOptions(req.accessContext!);
  setNoStore(res);
  res.status(200).json(options);
}

export async function clientSyncStatusHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const context = req.accessContext!;
  const isAdmin = context.role === "admin";
  const status = await getClientsSyncStatus({
    staleAfterHours: loadScheduledExchangeConfig().staleAfterHours,
    includeAdminDetail: isAdmin,
  });
  setNoStore(res);
  if (!isAdmin) {
    res.status(200).json({
      freshnessState: status.freshnessState,
      lastSuccessfulImportAtLabel: status.lastSuccessfulImportAtLabel,
      runningImport: status.runningImport,
      warning: status.warning,
    });
    return;
  }
  res.status(200).json(status);
}

export async function getClientHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const guid = typeof req.params.guid === "string" ? req.params.guid.trim() : "";
  if (!isValidUuidParam(guid)) {
    sendValidationError(res, "Некорректный идентификатор клиента.");
    return;
  }

  const client = await getClientByGuid(req.accessContext!, guid.toLowerCase());
  setNoStore(res);
  if (!client) {
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Клиент не найден."));
    return;
  }

  res.status(200).json({ client });
}
