import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { NATIVE_SENDER_HANDOFF_GUIDANCE as SENDER_HANDOFF_GUIDANCE } from "../../tan-tracker/sender-handoff-guidance";
import { loadAccessContext } from "../../access/context";
import { createTransferInTransaction } from "../../tan-tracker/create-transfer-service";
import { confirmExternalRequestDraft } from "../../tan-tracker/external-request/confirm";
import { externalRequestDueAtFromMode } from "../../tan-tracker/external-request/due-at-msk";
import { tanTrackerCanWrite } from "../../tan-tracker/guards";
import type { NativeCreateDraftPayload } from "./draft-scope";
import { buildExternalPendingInviteMessage } from "./invitation-handoff";

async function stageDraftFilesForStaff(
  client: PoolClient,
  draftId: string,
  ownerUserId: string,
): Promise<string[]> {
  const files = await client.query<{
    storage_key: string;
    file_name: string;
    mime_type: string;
    byte_size: string;
  }>(
    `SELECT storage_key, file_name, mime_type, byte_size::text
     FROM tt_external_request_draft_files WHERE draft_id = $1::uuid ORDER BY sort_order`,
    [draftId],
  );
  const ids: string[] = [];
  for (const f of files.rows) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO tt_staged_attachments (id, owner_user_id, storage_key, original_name, mime_type, byte_size)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::bigint)`,
      [id, ownerUserId, f.storage_key, f.file_name, f.mime_type, f.byte_size],
    );
    ids.push(id);
  }
  return ids;
}

export async function confirmNativeStaffDraft(
  client: PoolClient,
  input: {
    staffUserId: string;
    draftId: string;
    payload: NativeCreateDraftPayload;
    channel: "telegram" | "max";
  },
): Promise<{ publicCode: string; resultText: string; forwardInvitationText?: string }> {
  const locked = await client.query<{
    confirmed_transfer_id: string | null;
    payload: NativeCreateDraftPayload;
  }>(
    `SELECT confirmed_transfer_id, payload FROM tt_external_request_drafts WHERE id = $1::uuid FOR UPDATE`,
    [input.draftId],
  );
  const row = locked.rows[0];
  if (!row) throw Object.assign(new Error("Черновик не найден."), { http: 404 });
  if (row.confirmed_transfer_id) {
    return {
      publicCode: row.confirmed_transfer_id,
      resultText: `Передача уже создана: ${row.confirmed_transfer_id}.`,
    };
  }

  const userRow = await client.query<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
  }>(
    `SELECT id::text, email, full_name, phone, role FROM users WHERE id = $1::uuid AND status = 'active'`,
    [input.staffUserId],
  );
  const user = userRow.rows[0];
  if (!user) throw Object.assign(new Error("Профиль недоступен."), { http: 403 });

  const access = await loadAccessContext(user.id, user.role as import("../../shared/user").UserRole, client);
  const userDto = {
    id: user.id,
    fullName: user.full_name,
    phone: user.phone,
    role: user.role as import("../../shared/user").UserRole,
    email: user.email,
    status: "active" as const,
    lastLoginAt: null,
  };
  if (!tanTrackerCanWrite(userDto, access)) {
    throw Object.assign(new Error("Создание передач недоступно."), { http: 403 });
  }

  const item = String(input.payload.item ?? "").trim();
  if (!item) throw Object.assign(new Error("Укажите предмет."), { http: 400 });

  let finalRecipientPartyId: string | undefined;
  let finalRecipientExternal: { name: string; phone: string } | undefined;
  if (input.payload.recipientPartyId) {
    finalRecipientPartyId = input.payload.recipientPartyId;
  } else if (input.payload.recipientExternal?.name && input.payload.recipientExternal.phone) {
    finalRecipientExternal = input.payload.recipientExternal;
  } else {
    throw Object.assign(new Error("Выберите получателя."), { http: 400 });
  }

  await client.query("SAVEPOINT native_staff_confirm");
  let publicCode: string;
  try {
    const stagingIds = await stageDraftFilesForStaff(client, input.draftId, input.staffUserId);
    const dueMode = input.payload.dueMode;
    const dueAt =
      dueMode === "none" || !dueMode
        ? null
        : externalRequestDueAtFromMode(dueMode === "tomorrow" ? "tomorrow" : "today");

    publicCode = await createTransferInTransaction(
      client,
      { user: userDto, access },
      {
        item,
        comment: input.payload.comment ?? null,
        dueAt,
        finalRecipientPartyId: finalRecipientExternal ? undefined : finalRecipientPartyId,
        finalRecipientExternal,
        stagingAttachmentIds: stagingIds,
        auditDetail: { source: "native_bot" },
      },
    );

    await client.query(
      `UPDATE tt_external_request_drafts
       SET confirmed_transfer_id = $2, step = 'done', idempotency_key = $3, updated_at = NOW()
       WHERE id = $1::uuid`,
      [input.draftId, publicCode, `native-staff:${input.draftId}`],
    );
    await client.query("RELEASE SAVEPOINT native_staff_confirm");
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT native_staff_confirm");
    throw err;
  }

  const pending = await client.query<{ pending_party_id: string; kind: string; handoff_version: number }>(
    `SELECT t.pending_party_id::text, p.kind, t.handoff_version
     FROM tt_transfers t
     LEFT JOIN tt_parties p ON p.id = t.pending_party_id
     WHERE t.id = $1`,
    [publicCode],
  );
  const pRow = pending.rows[0];
  if (pRow?.kind === "external" && pRow.pending_party_id) {
    const invite = await buildExternalPendingInviteMessage(client, {
      transferId: publicCode,
      pendingPartyId: pRow.pending_party_id,
      handoffVersion: pRow.handoff_version,
      channel: input.channel,
    });
    if (invite) {
      return {
        publicCode,
        resultText: `Передача создана: ${publicCode}.\nСледом придёт готовое приглашение. Перешлите его получателю целиком.\n\n${SENDER_HANDOFF_GUIDANCE}\nКарточка доступна через «Мои передачи».`,
        forwardInvitationText: invite,
      };
    }
  }
  return {
    publicCode,
    resultText: `Передача создана: ${publicCode}. Получатель увидит её в личном кабинете.\n\n${SENDER_HANDOFF_GUIDANCE}\nКарточка доступна через «Мои передачи».`,
  };
}

export async function confirmNativeExternalDraft(
  client: PoolClient,
  input: {
    personId: string;
    externalPartyId: string;
    draftId: string;
  },
): Promise<{ publicCode: string }> {
  await client.query("SAVEPOINT native_ext_confirm");
  try {
    const result = await confirmExternalRequestDraft(client, {
      personId: input.personId,
      externalPartyId: input.externalPartyId,
      draftId: input.draftId,
      idempotencyKey: `native-ext:${input.draftId}`,
    });
    await client.query("RELEASE SAVEPOINT native_ext_confirm");
    return result;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT native_ext_confirm");
    throw err;
  }
}
