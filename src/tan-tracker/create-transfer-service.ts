import type { PoolClient } from "pg";
import type { AccessContext } from "../access/types";
import type { UserDto } from "../shared/user";
import { resolveTanTrackerAuditUserId } from "./effective-user";
import { ensurePartyForUserOnWrite, nextPublicTransferCode } from "./repository";
import { resolveRecipientPartyId, type ExternalRecipientInput } from "./party-eligibility";
import { linkStagedAttachmentsToTransfer } from "./attachments";
import { tanTrackerCanWrite } from "./guards";
import { notifyAdminsOfNewTrack } from "./admin-overview";

export type CreateTransferInput = {
  item: string;
  qty?: string | null;
  comment?: string | null;
  dueAt?: Date | null;
  finalRecipientPartyId?: string;
  finalRecipientExternal?: ExternalRecipientInput;
  relayPartyId?: string | null;
  relayExternal?: ExternalRecipientInput;
  stagingAttachmentIds?: string[];
  auditDetail?: Record<string, unknown>;
};

export type CreateTransferActor = {
  user: UserDto;
  access: AccessContext;
};

function parseDueAt(raw: Date | null | undefined): Date | null {
  if (!raw) return null;
  if (Number.isNaN(raw.getTime())) {
    throw Object.assign(new Error("Некорректная дата срока."), { http: 400 });
  }
  return raw;
}

/** Canonical staff/LK transfer creation (same SQL as HTTP createTransferHandler). */
export async function createTransferInTransaction(
  client: PoolClient,
  actor: CreateTransferActor,
  body: CreateTransferInput,
): Promise<string> {
  const { user, access } = actor;
  if (!tanTrackerCanWrite(user, access)) {
    throw Object.assign(new Error("Создание передач недоступно для этой роли или режима."), { http: 403 });
  }
  const item = String(body.item ?? "").trim().slice(0, 500);
  if (!item) {
    throw Object.assign(new Error("Укажите, что передаёте."), { http: 400 });
  }

  const auditUserId = resolveTanTrackerAuditUserId(user, access);

  const holderParty = await ensurePartyForUserOnWrite(client, user.id, user.fullName, user.phone);
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
  const dueAt = parseDueAt(body.dueAt ?? null);
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
    [
      publicCode,
      auditUserId,
      holderParty.id,
      JSON.stringify(body.auditDetail ? { item, ...body.auditDetail } : { item }),
    ],
  );
  const stagingRaw = Array.isArray(body.stagingAttachmentIds)
    ? body.stagingAttachmentIds.map(String).filter(Boolean)
    : [];
  if (stagingRaw.length > 10) {
    throw Object.assign(new Error("Не более 10 файлов на передачу."), { http: 400 });
  }
  if (stagingRaw.length) {
    await linkStagedAttachmentsToTransfer(client, user.id, publicCode, stagingRaw);
  }
  await notifyAdminsOfNewTrack(client, publicCode);
  return publicCode;
}
