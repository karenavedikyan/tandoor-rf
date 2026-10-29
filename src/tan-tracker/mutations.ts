import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { withTransaction } from "../access/db";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { ensurePartyForUserOnWrite, nextPublicTransferCode } from "./repository";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";
import { resolveRecipientPartyId, type ExternalRecipientInput } from "./party-eligibility";
import { linkStagedAttachmentsToTransfer } from "./attachments";

type CreateBody = {
  item?: string;
  qty?: string;
  comment?: string;
  dueAt?: string | null;
  finalRecipientPartyId?: string;
  finalRecipientExternal?: ExternalRecipientInput;
  relayPartyId?: string | null;
  relayExternal?: ExternalRecipientInput;
  stagingAttachmentIds?: string[];
};

function parseDueAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error("Некорректная дата срока."), { http: 400 });
  }
  return d;
}

export async function createTransferHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;

  const body = req.body as CreateBody;
  const item = String(body.item ?? "").trim().slice(0, 500);
  if (!item) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите, что передаёте."));
    return;
  }

  const auditUserId = resolveTanTrackerAuditUserId(req.authUser!, access);

  let created: string;
  try {
    created = await withTransaction(async (client) => {
      const holderParty = await ensurePartyForUserOnWrite(
        client,
        user.id,
        user.fullName,
        user.phone,
      );
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
      if (finalId === holderParty.id || pendingId === holderParty.id) {
        throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
      }
      const dueAt = parseDueAt(body.dueAt);
      const publicCode = await nextPublicTransferCode(client);
      await client.query(
        `INSERT INTO tt_transfers (
        id, public_code, item_title, qty_label, comment_text, status,
        creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
        due_at, handoff_version
      ) VALUES ($1,$1,$2,$3,$4,'waiting',$5,$5,$6,$7,$8,1)`,
        [
          publicCode,
          item,
          body.qty?.trim()?.slice(0, 120) || null,
          body.comment?.trim()?.slice(0, 2000) || null,
          holderParty.id,
          pendingId,
          finalId,
          dueAt,
        ],
      );
      const note = relayId
        ? "Создана передача · сначала промежуточному звену"
        : "Создана передача · конечному получателю";
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5::uuid)`,
        [publicCode, holderParty.id, pendingId, note, auditUserId],
      );
      await client.query(
        `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
       VALUES ($1,1,$2,$3,$4)`,
        [publicCode, holderParty.id, pendingId, item],
      );
      await client.query(
        `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
       VALUES ($1,$2::uuid,$3,'create',$4::jsonb)`,
        [publicCode, auditUserId, holderParty.id, JSON.stringify({ item })],
      );
      const stagingRaw = Array.isArray(body.stagingAttachmentIds)
        ? body.stagingAttachmentIds.map(String).filter(Boolean)
        : [];
      if (stagingRaw.length > 10) {
        throw Object.assign(new Error("Не более 10 файлов на передачу."), { http: 400 });
      }
      const stagingIds = stagingRaw;
      if (stagingIds.length) {
        await linkStagedAttachmentsToTransfer(client, user.id, publicCode, stagingIds);
      }
      return publicCode;
    });
  } catch (err: unknown) {
    const http = (err as { http?: number }).http;
    const message = err instanceof Error ? err.message : "Не удалось создать передачу.";
    if (http === 400 || http === 403 || http === 404) {
      setNoStore(res);
      res
        .status(http)
        .json(apiError(http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR, message));
      return;
    }
    throw err;
  }

  setNoStore(res);
  const forceRefreshFault =
    process.env.NODE_ENV === "test" && process.env.TT_TEST_BOOTSTRAP_FAIL_AFTER_CREATE === "1";
  try {
    if (forceRefreshFault) {
      throw new Error("injected bootstrap failure");
    }
    const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
    res.status(201).json({
      publicCode: created,
      bootstrap,
    });
  } catch {
    res.status(201).json({
      publicCode: created,
      bootstrap: null,
      refreshRequired: true,
    });
  }
}
