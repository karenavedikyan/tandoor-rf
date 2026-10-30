import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { ensurePartyForUserOnWrite } from "./repository";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";

export async function legacyCompleteHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);

  type Outcome =
    | { ok: true }
    | { ok: false; http: number; message: string };

  let outcome: Outcome;
  try {
    outcome = await withTransaction(async (client) => {
      const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
      const row = (
        await client.query<{
          id: string;
          status: string;
          creator_party_id: string;
          holder_party_id: string;
          pending_party_id: string | null;
          final_recipient_party_id: string | null;
          allow_legacy_complete: boolean;
          row_version: number;
          handoff_version: number;
        }>(
          `SELECT id, status, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
                  allow_legacy_complete, row_version, handoff_version
           FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1 FOR UPDATE`,
          [transferId],
        )
      ).rows[0];
      if (!row) {
        return { ok: false, http: 404, message: "Передача не найдена." };
      }
      if (row.status === "completed") {
        return { ok: false, http: 409, message: "Передача уже завершена." };
      }
      if (row.status !== "active" && row.status !== "waiting" && row.status !== "delivered") {
        return { ok: false, http: 409, message: "Передача недоступна для завершения." };
      }
      if (row.pending_party_id) {
        return {
          ok: false,
          http: 409,
          message: "Сначала отмените ожидание или подтвердите передачу.",
        };
      }
      const isHolder = row.holder_party_id === party.id;
      const isCreatorClosingDelivered =
        row.creator_party_id === party.id &&
        row.status === "delivered" &&
        !row.pending_party_id &&
        row.holder_party_id !== party.id;
      if (!isHolder && !isCreatorClosingDelivered) {
        return {
          ok: false,
          http: 403,
          message: "Завершить может текущий держатель или создатель после доставки.",
        };
      }
      if (
        isHolder &&
        row.final_recipient_party_id &&
        row.holder_party_id !== row.final_recipient_party_id &&
        !row.allow_legacy_complete
      ) {
        return {
          ok: false,
          http: 403,
          message: "Промежуточный держатель не может завершить передачу — передайте конечному получателю.",
        };
      }
      if (
        isCreatorClosingDelivered &&
        row.final_recipient_party_id &&
        row.holder_party_id !== row.final_recipient_party_id
      ) {
        return {
          ok: false,
          http: 403,
          message: "Закрыть можно только после доставки конечному получателю.",
        };
      }
      await client.query(
        `UPDATE tt_transfers SET status = 'completed', completed_at = NOW(),
                handoff_version = handoff_version + 1, row_version = row_version + 1
         WHERE id = $1 AND row_version = $2`,
        [row.id, row.row_version],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
         VALUES ($1,$2,$2,$3,$4::uuid)`,
        [row.id, row.holder_party_id, "Передача явно завершена", auditUserId],
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,$2::uuid,$3,'legacy_complete','{}'::jsonb)`,
        [row.id, auditUserId, party.id],
      );
      return { ok: true };
    });
  } catch {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось завершить передачу."));
    return;
  }

  if (!outcome.ok) {
    setNoStore(res);
    res.status(outcome.http).json(
      apiError(
        outcome.http === 403
          ? ERROR_CODES.FORBIDDEN
          : outcome.http === 404
            ? ERROR_CODES.NOT_FOUND
            : ERROR_CODES.VALIDATION_ERROR,
        outcome.message,
      ),
    );
    return;
  }

  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
