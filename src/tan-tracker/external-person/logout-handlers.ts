import type { Request, Response } from "express";
import { withTransaction } from "../../access/db";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { resolveExternalPersonAuth } from "./resolve-auth";
import { revokeAllExternalPersonSessions } from "./person-service";
import { getPool } from "../../db/pool";

/** Logout all devices: bumps access_epoch and revokes every browser session. */
export async function externalPersonLogoutAllHandler(req: Request, res: Response): Promise<void> {
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const resolved = await resolveExternalPersonAuth(pool, {
    est: String(req.body?.est ?? req.query.est ?? ""),
    cap: String(req.body?.cap ?? req.query.cap ?? ""),
  });
  if (!resolved) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна или истекла."));
    return;
  }
  await withTransaction(async (client) => {
    await revokeAllExternalPersonSessions(client, resolved.personId);
  });
  setNoStore(res);
  res.status(200).json({ ok: true });
}
