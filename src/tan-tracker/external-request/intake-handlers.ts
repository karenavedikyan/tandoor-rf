import type { Request, Response } from "express";
import { getPool } from "../../db/pool";
import { setNoStore } from "../../http/no-store";
import type { AccessRequest } from "../../access/middleware";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { requireTanTrackerMutationAccess } from "../guards";
import { resolveExternalPersonAuth } from "../external-person/resolve-auth";
import { hasPriorTransferRelationship } from "./intake";

export async function listExternalIntakeRecipientsPublicHandler(req: Request, res: Response): Promise<void> {
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const person = await resolveExternalPersonAuth(pool, {
    est: String(req.query.est ?? ""),
    cap: String(req.query.cap ?? ""),
  });
  if (!person) {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Сессия недоступна или истекла."));
    return;
  }
  const rows = await pool.query<{ user_id: string; full_name: string; accepts_external_tt_intake: boolean }>(
    `SELECT u.id::text AS user_id, u.full_name, u.accepts_external_tt_intake
     FROM users u
     WHERE u.status = 'active'
     ORDER BY u.full_name ASC
     LIMIT 500`,
  );
  const recipients = [];
  for (const row of rows.rows) {
    const intakeOk = row.accepts_external_tt_intake === true;
    const related = await hasPriorTransferRelationship(pool, person.partyId, row.user_id);
    if (intakeOk || related) {
      recipients.push({ userId: row.user_id, fullName: row.full_name });
    }
  }
  setNoStore(res);
  res.status(200).json({ recipients });
}

export async function patchStaffExternalIntakeHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  if (gate.access.role !== "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Только администратор может менять приём заявок."));
    return;
  }
  const userId = String(req.params.userId ?? "").trim();
  const accepts = !!(req.body as { acceptsExternalIntake?: boolean })?.acceptsExternalIntake;
  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Сервис недоступен."));
    return;
  }
  const updated = await pool.query(
    `UPDATE users SET accepts_external_tt_intake = $2 WHERE id = $1::uuid RETURNING id`,
    [userId, accepts],
  );
  if (!updated.rowCount) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Пользователь не найден."));
    return;
  }
  setNoStore(res);
  res.status(200).json({ ok: true, userId, acceptsExternalIntake: accepts });
}

export async function listEligibleStaffForExternalParty(
  client: import("pg").Pool | import("pg").PoolClient,
  externalPartyId: string,
): Promise<Array<{ userId: string; fullName: string }>> {
  const rows = await client.query<{ user_id: string; full_name: string; accepts_external_tt_intake: boolean }>(
    `SELECT u.id::text AS user_id, u.full_name, u.accepts_external_tt_intake
     FROM users u
     WHERE u.status = 'active'
     ORDER BY u.full_name ASC
     LIMIT 500`,
  );
  const out: Array<{ userId: string; fullName: string }> = [];
  for (const row of rows.rows) {
    const intakeOk = row.accepts_external_tt_intake === true;
    const related = await hasPriorTransferRelationship(client, externalPartyId, row.user_id);
    if (intakeOk || related) out.push({ userId: row.user_id, fullName: row.full_name });
  }
  return out;
}
