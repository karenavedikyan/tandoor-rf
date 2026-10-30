import type { Response } from "express";
import { withTransaction } from "../../access/db";
import { setNoStore } from "../../http/no-store";
import type { AccessRequest } from "../../access/middleware";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { resolveTanTrackerAuditUserId } from "../effective-user";
import { ensurePartyForUserOnWrite } from "../repository";
import { buildTanTrackerBootstrap } from "../service";
import { requireTanTrackerMutationAccess } from "../guards";

export async function declineExternalRequestHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const reason = String((req.body as { reason?: string })?.reason ?? "").trim().slice(0, 500);
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);

  const outcome = await withTransaction(async (client) => {
    const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
    const row = (
      await client.query<{
        id: string;
        from_external: boolean;
        pending_party_id: string | null;
        status: string;
        row_version: number;
        external_declined_at: Date | null;
      }>(
        `SELECT id, from_external, pending_party_id, status, row_version, external_declined_at FROM tt_transfers
         WHERE id = $1 OR public_code = $1 LIMIT 1 FOR UPDATE`,
        [transferId],
      )
    ).rows[0];
    if (!row || !row.from_external) return { ok: false as const, code: 404 };
    if (row.pending_party_id !== party.id) return { ok: false as const, code: 403 };
    if (row.status === "completed" || row.external_declined_at) return { ok: false as const, code: 409 };
    await client.query(
      `UPDATE tt_transfers SET pending_party_id = NULL, status = 'completed',
              external_declined_at = NOW(), external_decline_reason = $2,
              completed_at = NOW(), row_version = row_version + 1
       WHERE id = $1`,
      [row.id, reason || null],
    );
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$2,$3,$4::uuid)`,
      [row.id, party.id, reason ? `Заявка отклонена: ${reason}` : "Заявка отклонена", auditUserId],
    );
    return { ok: true as const };
  });

  if (!outcome.ok) {
    setNoStore(res);
    res
      .status(outcome.code)
      .json(apiError(outcome.code === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.NOT_FOUND, "Не удалось отклонить заявку."));
    return;
  }
  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
