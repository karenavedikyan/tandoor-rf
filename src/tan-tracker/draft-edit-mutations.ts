import type { Response } from "express";
import { withTransaction } from "../access/db";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { ensurePartyForUserOnWrite } from "./repository";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";
import { resolveRecipientPartyId, type ExternalRecipientInput } from "./party-eligibility";
import { linkStagedAttachmentsToTransfer } from "./attachments";
import { isBeforeFirstConfirmedCustody, transferHasConfirmedFirstCustody } from "./custody-state";
import { invalidateOpenHandoffArtifacts } from "./handoff-invalidation";
import {
  addTransferAttachmentsInTransaction,
  deleteTransferAttachmentInTransaction,
} from "./attachment-mutations";
import { loadTanTrackerTeamEmployeeGuids } from "./team-scope";
import type { AccessContext } from "../access/types";

type DraftEditBody = {
  item?: string;
  qty?: string;
  comment?: string;
  dueAt?: string | null;
  finalRecipientPartyId?: string;
  finalRecipientExternal?: ExternalRecipientInput;
  relayPartyId?: string | null;
  relayExternal?: ExternalRecipientInput;
  stagingAttachmentIds?: string[];
  removeAttachmentIds?: string[];
  rowVersion?: number;
};

function parseDueAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error("Некорректная дата срока."), { http: 400 });
  }
  return d;
}

export async function editTransferDraftHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;
  const transferId = String(req.params.id ?? "").trim().slice(0, 64);
  const body = req.body as DraftEditBody;
  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);

  const item = String(body.item ?? "").trim().slice(0, 500);
  if (!item) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите, что передаёте."));
    return;
  }
  const expectedRowVersion = Number(body.rowVersion);
  if (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 1) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите актуальную версию передачи."));
    return;
  }

  let done:
    | { ok: true }
    | { ok: false; code: number; message: string };

  try {
    done = await withTransaction(async (client) => {
      const party = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
      const locked = await client.query<{
        id: string;
        public_code: string;
        item_title: string;
        qty_label: string | null;
        comment_text: string | null;
        status: string;
        creator_party_id: string;
        holder_party_id: string;
        pending_party_id: string | null;
        final_recipient_party_id: string | null;
        handoff_version: number;
        row_version: number;
        due_at: Date | null;
        first_custody_at: Date | null;
      }>(
        `SELECT id, public_code, item_title, qty_label, comment_text, status,
                creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
                handoff_version, row_version, due_at, first_custody_at
         FROM tt_transfers
         WHERE id = $1 OR public_code = $1
         LIMIT 1
         FOR UPDATE`,
        [transferId],
      );
      const row = locked.rows[0];
      if (!row) return { ok: false as const, code: 404, message: "Передача не найдена." };
      if (row.row_version !== expectedRowVersion) {
        return {
          ok: false as const,
          code: 409,
          message: "Передача уже изменилась. Обновите страницу и повторите.",
        };
      }
      if (row.holder_party_id !== party.id) {
        return { ok: false as const, code: 403, message: "Редактировать может только текущий держатель." };
      }
      if (
        !isBeforeFirstConfirmedCustody(row) ||
        (await transferHasConfirmedFirstCustody(client, row.id))
      ) {
        return {
          ok: false as const,
          code: 403,
          message: "После первой передачи полное редактирование недоступно.",
        };
      }

      const finalId = await resolveRecipientPartyId(
        client,
        access,
        user.id,
        body.finalRecipientPartyId,
        body.finalRecipientExternal,
      );
      let relayId: string | null = null;
      if (body.relayPartyId || body.relayExternal) {
        relayId = await resolveRecipientPartyId(
          client,
          access,
          user.id,
          body.relayPartyId ?? undefined,
          body.relayExternal,
        );
      }
      const pendingId = relayId || finalId;
      if (finalId === party.id || pendingId === party.id) {
        return { ok: false as const, code: 400, message: "Нельзя назначить себя получателем." };
      }

      const dueAt = parseDueAt(body.dueAt);
      const qty = body.qty?.trim()?.slice(0, 120) || null;
      const comment = body.comment?.trim()?.slice(0, 2000) || null;

      const prevPending = row.pending_party_id;
      const routeChanged =
        row.final_recipient_party_id !== finalId ||
        row.pending_party_id !== pendingId ||
        (row.pending_party_id == null && pendingId != null);

      if (prevPending && prevPending !== pendingId) {
        await client.query(
          `INSERT INTO tt_transfer_revoked_parties (transfer_id, party_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [row.id, prevPending],
        );
      }

      await invalidateOpenHandoffArtifacts(client, row.id);
      const nextVer = row.handoff_version + 1;
      await client.query(
        `UPDATE tt_transfers SET
           item_title = $2, qty_label = $3, comment_text = $4, due_at = $5,
           final_recipient_party_id = $6, pending_party_id = $7, status = 'waiting',
           handoff_version = $8, row_version = row_version + 1
         WHERE id = $1`,
        [row.id, item, qty, comment, dueAt, finalId, pendingId, nextVer],
      );
      await client.query(
        `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
         VALUES ($1,$2,$3,$4,$5)`,
        [row.id, nextVer, party.id, pendingId, item],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
         VALUES ($1,$2,$3,$4,$5::uuid)`,
        [row.id, party.id, pendingId, "Изменены данные передачи (до первой передачи)", auditUserId],
      );

      const stagingRaw = Array.isArray(body.stagingAttachmentIds)
        ? body.stagingAttachmentIds.map(String).filter(Boolean)
        : [];
      const removeRaw = Array.isArray(body.removeAttachmentIds)
        ? body.removeAttachmentIds.map(String).filter(Boolean)
        : [];
      if (stagingRaw.length + removeRaw.length > 10) {
        throw Object.assign(new Error("Не более 10 файлов на передачу."), { http: 400 });
      }

      const teamGuids = await loadTanTrackerTeamEmployeeGuids({
        ...access,
        userId: user.id,
        role: user.role as AccessContext["role"],
      });
      const partyMap = new Map<string, string | null>();
      const scopeCtx = {
        userId: user.id,
        role: user.role,
        employeeId: access.employeeId,
        actorPartyId: party.id,
        previewReadOnly: !!access.preview?.readOnly,
      };

      for (const attId of removeRaw) {
        await deleteTransferAttachmentInTransaction(client, {
          transferId: row.id,
          attId,
          actorPartyId: party.id,
          scopeCtx,
          teamGuids,
          partyMap,
        });
      }
      if (stagingRaw.length) {
        await addTransferAttachmentsInTransaction(client, {
          transferId: row.id,
          userId: user.id,
          stagingIds: stagingRaw,
          actorPartyId: party.id,
          scopeCtx,
          teamGuids,
          partyMap,
        });
      }

      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
         VALUES ($1,$2::uuid,$3,'draft_edit',$4::jsonb)`,
        [
          row.id,
          auditUserId,
          party.id,
          JSON.stringify({
            routeChanged,
            handoffVersion: nextVer,
            item,
          }),
        ],
      );

      return { ok: true as const };
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http;
    const message = err instanceof Error ? err.message : "Не удалось сохранить изменения.";
    if (http === 400 || http === 403 || http === 404) {
      setNoStore(res);
      res
        .status(http)
        .json(
          apiError(
            http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR,
            message,
          ),
        );
      return;
    }
    throw err;
  }

  if (!done.ok) {
    setNoStore(res);
    const code =
      done.code === 403
        ? ERROR_CODES.FORBIDDEN
        : done.code === 409
          ? ERROR_CODES.VALIDATION_ERROR
          : done.code === 404
            ? ERROR_CODES.NOT_FOUND
            : ERROR_CODES.VALIDATION_ERROR;
    res.status(done.code).json(apiError(code, done.message));
    return;
  }

  const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
  setNoStore(res);
  res.status(200).json({ ok: true, bootstrap });
}
