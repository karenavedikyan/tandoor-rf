import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { buildNotificationTransferState, formatNotificationTransferState } from "../../tan-tracker/notification-transfer-state";
import { NATIVE_SENDER_HANDOFF_GUIDANCE as SENDER_HANDOFF_GUIDANCE } from "../../tan-tracker/sender-handoff-guidance";
import { loadAccessContext } from "../../access/context";
import { createTransferInTransaction } from "../../tan-tracker/create-transfer-service";
import { confirmExternalRequestDraft } from "../../tan-tracker/external-request/confirm";
import {
  countOpenExternalRequests,
  MAX_OPEN_EXTERNAL_REQUESTS,
} from "../../tan-tracker/external-request/intake";
import { externalRequestDueAtFromMode } from "../../tan-tracker/external-request/due-at-msk";
import { resolveExternalRecipientPartyIdForExternalActor } from "../../tan-tracker/party-eligibility";
import { nextPublicTransferCode } from "../../tan-tracker/repository";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";
import {
  EmployeePhoneCollisionError,
  PhonePartyConflictError,
} from "../../tan-tracker/phone-party-resolver";
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
  const status = formatNotificationTransferState(await buildNotificationTransferState(client, publicCode));
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
        resultText: `Передача создана: ${publicCode}.\n\n${status}\n\nСледом придёт готовое приглашение. Перешлите его получателю целиком.\n\n${SENDER_HANDOFF_GUIDANCE}\nКарточка доступна через «Мои передачи».`,
        forwardInvitationText: invite,
      };
    }
  }
  return {
    publicCode,
    resultText: `Передача создана: ${publicCode}.\n\n${status}\n\nПолучатель увидит её в личном кабинете.\n\n${SENDER_HANDOFF_GUIDANCE}\nКарточка доступна через «Мои передачи».`,
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
    return { publicCode: result.publicCode };
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT native_ext_confirm");
    throw err;
  }
}

export async function confirmNativeExternalToExternalDraft(
  client: PoolClient,
  input: {
    personId: string;
    externalPartyId: string;
    draftId: string;
  },
): Promise<{ publicCode: string }> {
  const idempotencyKey = `native-ext2ext:${input.draftId}`;

  const person = (
    await client.query<{ party_id: string }>(
      `SELECT party_id::text FROM tt_external_persons WHERE id = $1::uuid FOR UPDATE`,
      [input.personId],
    )
  ).rows[0];
  if (!person || person.party_id !== input.externalPartyId) {
    throw Object.assign(new Error("Профиль недоступен."), { http: 403 });
  }

  const draft = (
    await client.query<{
      payload: NativeCreateDraftPayload;
      idempotency_key: string | null;
      confirmed_transfer_id: string | null;
      person_id: string | null;
    }>(
      `SELECT payload, idempotency_key, confirmed_transfer_id, person_id::text
       FROM tt_external_request_drafts WHERE id = $1::uuid FOR UPDATE`,
      [input.draftId],
    )
  ).rows[0];
  if (!draft) throw Object.assign(new Error("Черновик не найден."), { http: 404 });
  if (draft.person_id && draft.person_id !== input.personId) {
    throw Object.assign(new Error("Черновик принадлежит другой сессии."), { http: 403 });
  }
  if (draft.confirmed_transfer_id) {
    const existing = await client.query<{ public_code: string }>(
      `SELECT public_code FROM tt_transfers WHERE id = $1 LIMIT 1`,
      [draft.confirmed_transfer_id],
    );
    if (existing.rows[0]) {
      return { publicCode: existing.rows[0].public_code };
    }
  }
  if (draft.idempotency_key === idempotencyKey && draft.confirmed_transfer_id) {
    const existing = await client.query<{ public_code: string }>(
      `SELECT public_code FROM tt_transfers WHERE id = $1 LIMIT 1`,
      [draft.confirmed_transfer_id],
    );
    if (existing.rows[0]) {
      return { publicCode: existing.rows[0].public_code };
    }
  }

  const open = await countOpenExternalRequests(client, input.externalPartyId);
  if (open >= MAX_OPEN_EXTERNAL_REQUESTS) {
    throw Object.assign(new Error("Достигнут лимит открытых заявок (5)."), { http: 409 });
  }

  const payload = draft.payload ?? {};
  const item = String(payload.item ?? "").trim();
  const phoneRaw = payload.externalRecipientPhone?.trim() ?? "";
  const name = payload.externalRecipientDisplayName?.trim() ?? "";
  if (!item || !phoneRaw || !name) {
    throw Object.assign(new Error("Заполните все шаги заявки."), { http: 409 });
  }
  const phoneE164 = normalizeRuPhoneE164(phoneRaw);
  if (!phoneE164) {
    throw Object.assign(new Error("Введите телефон: 10 цифр после +7."), { http: 400 });
  }

  const senderPhone = (
    await client.query<{ phone_e164: string | null }>(
      `SELECT phone_e164 FROM tt_parties WHERE id = $1::uuid LIMIT 1`,
      [input.externalPartyId],
    )
  ).rows[0]?.phone_e164;
  const senderPhoneNorm = senderPhone ? normalizeRuPhoneE164(senderPhone) : null;
  if (senderPhoneNorm && senderPhoneNorm === phoneE164) {
    throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
  }

  let recipientPartyId: string;
  try {
    recipientPartyId = await resolveExternalRecipientPartyIdForExternalActor(client, {
      name,
      phone: phoneE164,
    });
  } catch (err) {
    if (err instanceof PhonePartyConflictError || err instanceof EmployeePhoneCollisionError) {
      throw Object.assign(err, { http: err.http });
    }
    throw err;
  }
  if (recipientPartyId === input.externalPartyId) {
    throw Object.assign(new Error("Нельзя назначить себя получателем."), { http: 400 });
  }

  const publicCode = await nextPublicTransferCode(client);
  const dueAt = externalRequestDueAtFromMode(
    payload.dueMode === "none" ? undefined : payload.dueMode,
  );
  await client.query(
    `INSERT INTO tt_transfers (
       id, public_code, item_title, comment_text, status, from_external,
       creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
       due_at, handoff_version
     ) VALUES ($1,$1,$2,$3,'waiting',TRUE,$4,$4,$5,$5,$6,1)`,
    [
      publicCode,
      item,
      payload.comment?.trim()?.slice(0, 2000) || null,
      input.externalPartyId,
      recipientPartyId,
      dueAt,
    ],
  );
  await client.query(
    `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note)
     VALUES ($1,$2,$3,$4)`,
    [publicCode, input.externalPartyId, recipientPartyId, "Создана передача · внешнему получателю"],
  );
  await client.query(
    `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
     VALUES ($1,1,$2,$3,$4)`,
    [publicCode, input.externalPartyId, recipientPartyId, item],
  );
  await client.query(
    `INSERT INTO tt_audit_log (transfer_id, actor_user_id, acting_party_id, action, detail)
     VALUES ($1,NULL,$2::uuid,'create',$3::jsonb)`,
    [
      publicCode,
      input.externalPartyId,
      JSON.stringify({ item, source: "native_bot", externalToExternal: true }),
    ],
  );
  const files = await client.query<{ storage_key: string; file_name: string; mime_type: string; byte_size: string }>(
    `SELECT storage_key, file_name, mime_type, byte_size::text FROM tt_external_request_draft_files WHERE draft_id = $1::uuid ORDER BY sort_order`,
    [input.draftId],
  );
  for (const f of files.rows) {
    await client.query(
      `INSERT INTO tt_transfer_attachments (transfer_id, storage_key, original_name, mime_type, byte_size, uploaded_by_user_id)
       VALUES ($1,$2,$3,$4,$5::bigint,NULL)`,
      [publicCode, f.storage_key, f.file_name, f.mime_type, f.byte_size],
    );
  }
  await client.query(
    `UPDATE tt_external_request_drafts
     SET idempotency_key = $2, confirmed_transfer_id = $3, step = 'done', person_id = COALESCE(person_id, $4::uuid), updated_at = NOW()
     WHERE id = $1::uuid`,
    [input.draftId, idempotencyKey, publicCode, input.personId],
  );
  return { publicCode };
}

export async function confirmNativeExternalToExternalDraftWithSavepoint(
  client: PoolClient,
  input: {
    personId: string;
    externalPartyId: string;
    draftId: string;
  },
): Promise<{ publicCode: string }> {
  await client.query("SAVEPOINT native_ext2ext_confirm");
  try {
    const result = await confirmNativeExternalToExternalDraft(client, input);
    await client.query("RELEASE SAVEPOINT native_ext2ext_confirm");
    return result;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT native_ext2ext_confirm");
    throw err;
  }
}
