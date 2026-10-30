import type { Request, Response } from "express";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { resolveExternalPersonAuth } from "./resolve-auth";
import { buildExternalPersonBootstrapPayload } from "./bootstrap-build";

export async function externalPersonBootstrapHandler(req: Request, res: Response): Promise<void> {
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const resolved = await resolveExternalPersonAuth(pool, {
    est: String(req.query.est ?? ""),
    cap: String(req.query.cap ?? ""),
  });
  if (!resolved) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна или истекла."));
    return;
  }
  const payload = await buildExternalPersonBootstrapPayload(pool, resolved);
  setNoStore(res);
  res.status(200).json(payload);
}
