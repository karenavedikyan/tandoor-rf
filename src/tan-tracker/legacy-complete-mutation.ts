import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { ensurePartyForUserOnWrite } from "./repository";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";
import { notifyClosed } from "./transfer-lk-notify";
import { notifyExternalPartyAfterHandoff } from "./transfer-external-messenger-notify";
import type { PoolClient } from "pg";
import { transferWriteBlocked } from "./transfer-write-guard";
import { invalidateOpenHandoffArtifacts } from "./handoff-invalidation";

export function checkTransferCompletionAccess(input: {
  status: string;
  actingPartyId: string;
  holderPartyId: string;
  pendingPartyId: string | null;
  finalRecipientPartyId: string | null;
  allowLegacyComplete: boolean;
}): { ok: true } | { ok: false; http: number; message: string } {
  if (input.status === "completed") return { ok: false, http: 409, message: "Передача уже завершена." };
  if (!["active", "waiting", "delivered"].includes(input.status)) {
    return { ok: false, http: 409, message: "Передача недоступна для завершения." };
  }
  if (input.pendingPartyId) return {
    ok: false, http: 409, message: "Сначала отмените ожидание или подтвердите передачу.",
  };
  if (!input.actingPartyId || input.actingPartyId !== input.holderPartyId) return {
    ok: false, http: 403, message: "Завершить может только текущий держатель. После передачи предмета ваше участие в этом этапе завершено.",
  };
  if (input.finalRecipientPartyId && input.holderPartyId !== input.finalRecipientPartyId && !input.allowLegacyComplete) {
    return { ok: false, http: 403, message: "Промежуточный держатель не может завершить передачу. Передайте конечному получателю." };
  }
  return { ok: true };
}

export async function completeTransferInTransaction(client: PoolClient, input: {
  transferId: string; actingPartyId: string; auditUserId: string | null;
  expectedHandoffVersion?: number; expectedRowVersion?: number;
}): Promise<{ ok: true } | { ok: false; http: number; message: string }> {
  const { transferId, actingPartyId, auditUserId } = input;
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
      public_code: string;
      item_title: string;
      deleted_at: Date | null;
      general_archived_at: Date | null;
    }>(
      `SELECT id, status, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
              allow_legacy_complete, row_version, handoff_version, public_code, item_title,
              deleted_at, general_archived_at
       FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1 FOR UPDATE`,
      [transferId],
    )
  ).rows[0];
  if (!row) {
    return { ok: false, http: 404, message: "Передача не найдена." };
  }
  if (transferWriteBlocked(row)) return { ok: false, http: 403, message: "Передача недоступна." };
  if ((input.expectedHandoffVersion !== undefined && row.handoff_version !== input.expectedHandoffVersion)
      || (input.expectedRowVersion !== undefined && row.row_version !== input.expectedRowVersion)) {
    return { ok: false, http: 409, message: "Передача уже изменилась. Откройте её заново в «Моих передачах»." };
  }
  const permission = checkTransferCompletionAccess({
    status: row.status, actingPartyId, holderPartyId: row.holder_party_id,
    pendingPartyId: row.pending_party_id, finalRecipientPartyId: row.final_recipient_party_id,
    allowLegacyComplete: row.allow_legacy_complete,
  });
  if (!permission.ok) return permission;
  await client.query(
    `UPDATE tt_transfers SET status = 'completed', completed_at = NOW(),
            handoff_version = handoff_version + 1, row_version = row_version + 1
     WHERE id = $1 AND row_version = $2`,
    [row.id, row.row_version],
  );
  await invalidateOpenHandoffArtifacts(client, row.id);
  await client.query(
    `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
     VALUES ($1,$2,$2,$3,$4::uuid)`,
    [row.id, row.holder_party_id, "Передача явно завершена", auditUserId],
  );
  await client.query(
    `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
     VALUES ($1,$2::uuid,$3,'legacy_complete','{}'::jsonb)`,
    [row.id, auditUserId, actingPartyId],
  );
  const closedHv = row.handoff_version + 1;
  await notifyClosed(client, {
    transferId: row.id,
    publicCode: row.public_code,
    itemTitle: row.item_title,
    partyIds: [row.creator_party_id, row.holder_party_id, row.final_recipient_party_id].filter(
      (id): id is string => !!id,
    ),
    handoffVersion: closedHv,
    holderPartyId: row.holder_party_id,
  });
  await notifyExternalPartyAfterHandoff(client, {
    externalPartyId: row.holder_party_id,
    transferId: row.id,
    handoffVersion: closedHv,
    event: "closed",
  });
  await notifyExternalPartyAfterHandoff(client, {
    externalPartyId: row.creator_party_id,
    transferId: row.id,
    handoffVersion: closedHv,
    event: "closed",
  });
  return { ok: true };
}

export async function legacyCompleteHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);
  let outcome: Awaited<ReturnType<typeof completeTransferInTransaction>>;
  try {
    outcome = await withTransaction(async (client) => {
      const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
      return completeTransferInTransaction(client, { transferId, actingPartyId: party.id, auditUserId });
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
