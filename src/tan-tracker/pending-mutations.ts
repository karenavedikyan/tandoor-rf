import type { Response } from "express";
import { enqueueAutomaticReceiptCode } from "./automatic-receipt-codes";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { ensurePartyForUserOnWrite } from "./repository";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";
import { resolveRecipientPartyId } from "./party-eligibility";
import { invalidateOpenHandoffArtifacts } from "./handoff-invalidation";
import { notifyPendingCancelled, notifyReturnToCreator, notifyRouteContinued } from "./transfer-lk-notify";
import { transferWriteBlocked } from "./transfer-write-guard";
import { transferHasConfirmedFirstCustody } from "./custody-state";
import type { PoolClient } from "pg";

async function loadTransfer(client: { query: Function }, id: string) {
  const res = await client.query(
    `SELECT id, public_code, status, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
            handoff_version, row_version, item_title, delivered_at, deleted_at, general_archived_at
     FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1 FOR UPDATE`,
    [id],
  );
  return res.rows[0] as
    | {
        id: string;
        public_code: string;
        status: string;
        creator_party_id: string;
        holder_party_id: string;
        pending_party_id: string | null;
        final_recipient_party_id: string | null;
        handoff_version: number;
        row_version: number;
        item_title: string;
        delivered_at: Date | null;
        deleted_at: Date | null;
        general_archived_at: Date | null;
      }
    | undefined;
}

/** Caller resolves recipient eligibility; this shared mutation rechecks custody under row lock. */
export async function assignPendingRecipientInTransaction(
  client: PoolClient,
  input: {
    transferId: string; holderPartyId: string; pendingPartyId: string; auditUserId: string | null;
    expectedHandoffVersion?: number; expectedRowVersion?: number; requireNoPending?: boolean;
    replaceUnreceivedFinal?: boolean;
  },
): Promise<void> {
  const row = await loadTransfer(client, input.transferId);
  if (!row || transferWriteBlocked(row) || row.holder_party_id !== input.holderPartyId) {
    throw Object.assign(new Error("Передача недоступна."), { http: 403 });
  }
  if (!["active", "waiting", "delivered"].includes(row.status)
      || (input.requireNoPending && row.pending_party_id)
      || (input.expectedHandoffVersion !== undefined && row.handoff_version !== input.expectedHandoffVersion)
      || (input.expectedRowVersion !== undefined && row.row_version !== input.expectedRowVersion)) {
    throw Object.assign(new Error("Передача уже изменилась. Откройте её заново в «Моих передачах»."), { http: 409 });
  }
  if (input.pendingPartyId === row.holder_party_id) {
    throw Object.assign(new Error("Нельзя передать самому себе."), { http: 400 });
  }
  const prev = row.pending_party_id;
  const replaceFinal = input.replaceUnreceivedFinal === true && prev != null &&
    prev === row.final_recipient_party_id && row.creator_party_id === input.holderPartyId &&
    !(await transferHasConfirmedFirstCustody(client, row.id));
  if (prev && prev !== input.pendingPartyId) {
    await client.query(
      `INSERT INTO tt_transfer_revoked_parties (transfer_id, party_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [row.id, prev],
    );
  }
  await invalidateOpenHandoffArtifacts(client, row.id);
  const nextVer = row.handoff_version + 1;
  await client.query(
    `UPDATE tt_transfers SET pending_party_id=$2, status='waiting', handoff_version=$3,
            final_recipient_party_id=CASE WHEN $4::boolean THEN $2 ELSE final_recipient_party_id END,
            row_version=row_version+1 WHERE id=$1`, [row.id, input.pendingPartyId, nextVer, replaceFinal],
  );
  await client.query(
    `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
     VALUES ($1,$2,$3,$4,$5)`, [row.id, nextVer, row.holder_party_id, input.pendingPartyId, row.item_title],
  );
  await enqueueAutomaticReceiptCode(client, row.id);
  await client.query(
    `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
     VALUES ($1,$2,$3,$4,$5::uuid)`,
    [row.id, row.holder_party_id, input.pendingPartyId, "Назначен следующий получатель", input.auditUserId],
  );
  await client.query(
    `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
     VALUES ($1,$2::uuid,$3::uuid,'holder_pending_change',$4::jsonb)`,
    [row.id, input.auditUserId, row.holder_party_id, JSON.stringify({
      pendingPartyId: input.pendingPartyId,
      ...(replaceFinal ? { previousFinalRecipientPartyId: row.final_recipient_party_id,
        finalRecipientPartyId: input.pendingPartyId } : {}),
    })],
  );
  if (input.pendingPartyId === row.creator_party_id && input.pendingPartyId !== row.holder_party_id) {
    await notifyReturnToCreator(client, {
      transferId: row.id, publicCode: row.public_code, itemTitle: row.item_title,
      holderPartyId: row.holder_party_id, creatorPartyId: row.creator_party_id, handoffVersion: nextVer,
    });
  } else {
    await notifyRouteContinued(client, {
      transferId: row.id, publicCode: row.public_code, itemTitle: row.item_title,
      holderPartyId: row.holder_party_id, newPendingPartyId: input.pendingPartyId,
      creatorPartyId: row.creator_party_id, handoffVersion: nextVer,
    });
  }
}

export async function cancelPendingHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "");
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);

  const done = await withTransaction(async (client) => {
    const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
    const row = await loadTransfer(client, transferId);
    if (!row || transferWriteBlocked(row)) return { ok: false as const, code: transferWriteBlocked(row) ? 403 : 404 };
    if (!row.pending_party_id) return { ok: false as const, code: 404 };
    if (row.holder_party_id !== party.id) return { ok: false as const, code: 403 };
    const revoked = row.pending_party_id;
    const nextHandoffVersion = row.handoff_version + 1;
    const revertStatus = row.delivered_at != null ? "delivered" : "active";
    await client.query(
      `UPDATE tt_transfers SET pending_party_id = NULL, status = $2,
              handoff_version = handoff_version + 1, row_version = row_version + 1 WHERE id = $1`,
      [row.id, revertStatus],
    );
    await invalidateOpenHandoffArtifacts(client, row.id);
    await client.query(
      `INSERT INTO tt_transfer_revoked_parties (transfer_id, party_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [row.id, revoked],
    );
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5::uuid)`,
      [row.id, row.holder_party_id, revoked, "Ожидание передачи отменено", auditUserId],
    );
    await notifyPendingCancelled(client, {
      transferId: row.id,
      publicCode: row.public_code,
      itemTitle: row.item_title,
      holderPartyId: row.holder_party_id,
      revokedPendingPartyId: revoked,
      creatorPartyId: row.creator_party_id,
      handoffVersion: nextHandoffVersion,
    });
    return { ok: true as const };
  });

  if (!done.ok) {
    setNoStore(res);
    res
      .status(done.code)
      .json(apiError(done.code === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.NOT_FOUND, "Не удалось отменить ожидание."));
    return;
  }
  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}

export async function changePendingHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const pendingPartyId = String((req.body as { pendingPartyId?: string })?.pendingPartyId ?? "").trim();
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);
  if (!pendingPartyId) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Выберите получателя."));
    return;
  }

  let done: { ok: true } | { ok: false; code: number };
  try {
    done = await withTransaction(async (client) => {
    const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
    const row = await loadTransfer(client, transferId);
    if (!row || transferWriteBlocked(row)) return { ok: false as const, code: transferWriteBlocked(row) ? 403 : 404 };
    if (row.holder_party_id !== party.id) return { ok: false as const, code: 403 };
    if (pendingPartyId === row.holder_party_id) return { ok: false as const, code: 400 };
    if (row.status === "completed" || row.status === "obsolete") return { ok: false as const, code: 400 };
    const resolvedPendingPartyId = await resolveRecipientPartyId(client, access, user.id, pendingPartyId, undefined);
    await assignPendingRecipientInTransaction(client, {
      transferId: row.id, holderPartyId: party.id, pendingPartyId: resolvedPendingPartyId, auditUserId,
    });
    return { ok: true as const };
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http;
    if (http === 403 || http === 400 || http === 404 || http === 409) {
      setNoStore(res);
      res
        .status(http)
        .json(
          apiError(
            http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR,
            err instanceof Error ? err.message : "Не удалось сменить получателя.",
          ),
        );
      return;
    }
    throw err;
  }

  if (!done.ok) {
    const status = done.code;
    setNoStore(res);
    res.status(status).json(
      apiError(
        status === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR,
        status === 404 ? "Передача не найдена." : "Не удалось сменить получателя.",
      ),
    );
    return;
  }
  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
