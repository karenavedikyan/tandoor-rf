import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { ensurePartyForUserOnWrite } from "./repository";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";
import { assertPartyEligibleAsRecipient } from "./party-eligibility";
import { invalidateOpenHandoffArtifacts } from "./handoff-invalidation";
import { notifyPendingCancelled, notifyReturnToCreator, notifyRouteContinued } from "./transfer-lk-notify";
import { transferWriteBlocked } from "./transfer-write-guard";

async function loadTransfer(client: { query: Function }, id: string) {
  const res = await client.query(
    `SELECT id, public_code, status, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
            handoff_version, item_title, delivered_at, deleted_at, general_archived_at
     FROM tt_transfers WHERE id = $1 OR public_code = $1 LIMIT 1`,
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
        item_title: string;
        delivered_at: Date | null;
        deleted_at: Date | null;
        general_archived_at: Date | null;
      }
    | undefined;
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
    if (row.status === "completed") return { ok: false as const, code: 400 };
    await assertPartyEligibleAsRecipient(client, access, user.id, pendingPartyId);
    const prev = row.pending_party_id;
    if (prev && prev !== pendingPartyId) {
      await client.query(
        `INSERT INTO tt_transfer_revoked_parties (transfer_id, party_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [row.id, prev],
      );
    }
    await invalidateOpenHandoffArtifacts(client, row.id);
    const nextVer = row.handoff_version + 1;
    await client.query(
      `UPDATE tt_transfers SET pending_party_id = $2, status = 'waiting', handoff_version = $3,
              row_version = row_version + 1 WHERE id = $1`,
      [row.id, pendingPartyId, nextVer],
    );
    await client.query(
      `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
       VALUES ($1,$2,$3,$4,$5)`,
      [row.id, nextVer, row.holder_party_id, pendingPartyId, row.item_title],
    );
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5::uuid)`,
      [row.id, row.holder_party_id, pendingPartyId, "Назначен следующий получатель", auditUserId],
    );
    if (pendingPartyId === row.creator_party_id && pendingPartyId !== row.holder_party_id) {
      await notifyReturnToCreator(client, {
        transferId: row.id,
        publicCode: row.public_code,
        itemTitle: row.item_title,
        holderPartyId: row.holder_party_id,
        creatorPartyId: row.creator_party_id,
        handoffVersion: nextVer,
      });
    } else {
      await notifyRouteContinued(client, {
        transferId: row.id,
        publicCode: row.public_code,
        itemTitle: row.item_title,
        holderPartyId: row.holder_party_id,
        newPendingPartyId: pendingPartyId,
        creatorPartyId: row.creator_party_id,
        handoffVersion: nextVer,
      });
    }
    return { ok: true as const };
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http;
    if (http === 403 || http === 400) {
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
