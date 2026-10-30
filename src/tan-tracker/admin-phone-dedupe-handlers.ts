import type { Response } from "express";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { requireTanTrackerMutationAccess } from "./guards";
import { refreshPhoneDedupeReport } from "./phone-dedupe";

export async function adminRefreshPhoneDedupeHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  if (gate.access.role !== "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Только администратор."));
    return;
  }
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const result = await refreshPhoneDedupeReport(pool);
  const rows = await pool.query(
    `SELECT phone_e164, party_ids, kinds, detected_at FROM tt_phone_dedupe_conflicts WHERE resolved_at IS NULL ORDER BY detected_at DESC LIMIT 200`,
  );
  setNoStore(res);
  res.status(200).json({ refreshed: result.conflicts, conflicts: rows.rows });
}
