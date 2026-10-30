import type { Response } from "express";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { requireTanTrackerMutationAccess } from "./guards";
import { refreshPhoneDedupeReport } from "./phone-dedupe";
import {
  PhoneCanonicalValidationError,
  validateAdminPhoneCanonicalAssignment,
} from "./phone-canonical-validation";
import { EmployeePhoneCollisionError } from "./phone-party-resolver";

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

export async function adminSetPhoneCanonicalHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  if (gate.access.role !== "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Только администратор."));
    return;
  }
  const phoneRaw = String((req.body as { phoneE164?: string })?.phoneE164 ?? "").trim();
  const partyIdRaw = String((req.body as { partyId?: string })?.partyId ?? "").trim();
  const pool = getPool();
  if (!pool || !phoneRaw || !partyIdRaw) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите phoneE164 и partyId."));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const validated = await validateAdminPhoneCanonicalAssignment(client, {
      phoneE164Raw: phoneRaw,
      partyId: partyIdRaw,
    });
    await client.query(
      `INSERT INTO tt_phone_canonical_parties (phone_e164, party_id, set_by_user_id)
       VALUES ($1, $2::uuid, $3::uuid)
       ON CONFLICT (phone_e164) DO UPDATE SET party_id = EXCLUDED.party_id, set_by_user_id = EXCLUDED.set_by_user_id, set_at = NOW()`,
      [validated.phoneE164, validated.partyId, gate.user.id],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof PhoneCanonicalValidationError || err instanceof EmployeePhoneCollisionError) {
      setNoStore(res);
      const http = "http" in err && typeof err.http === "number" ? err.http : 400;
      res.status(http).json(apiError(ERROR_CODES.VALIDATION_ERROR, err.message));
      return;
    }
    throw err;
  } finally {
    client.release();
  }
  setNoStore(res);
  res.status(200).json({ ok: true });
}
