import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { loadAccessContext } from "../../access/context";
import { createTransferInTransaction } from "../../tan-tracker/create-transfer-service";
import { confirmExternalRequestDraft } from "../../tan-tracker/external-request/confirm";
import { externalRequestDueAtFromMode } from "../../tan-tracker/external-request/due-at-msk";
import type { NativeCreateDraftPayload } from "./draft-scope";

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
  },
): Promise<{ publicCode: string; invitationHint?: string }> {
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
  const item = String(input.payload.item ?? "").trim();
  if (!item) throw Object.assign(new Error("Укажите предмет."), { http: 400 });

  let finalRecipientPartyId: string | undefined;
  let finalRecipientExternal: { name: string; phone: string } | undefined;
  if (input.payload.recipientExternal?.name && input.payload.recipientExternal.phone) {
    finalRecipientExternal = input.payload.recipientExternal;
  } else if (input.payload.recipientPartyId) {
    finalRecipientPartyId = input.payload.recipientPartyId;
  } else if (input.payload.recipientUserId) {
    finalRecipientPartyId = input.payload.recipientUserId;
  } else {
    throw Object.assign(new Error("Выберите получателя."), { http: 400 });
  }

  const stagingIds = await stageDraftFilesForStaff(client, input.draftId, input.staffUserId);
  const dueMode = input.payload.dueMode;
  const dueAt =
    dueMode === "none" || !dueMode ? null : externalRequestDueAtFromMode(dueMode === "tomorrow" ? "tomorrow" : "today");

  const publicCode = await createTransferInTransaction(
    client,
    {
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role as import("../../shared/user").UserRole,
        email: user.email,
        status: "active",
        lastLoginAt: null,
      },
      access,
    },
    {
      item,
      comment: input.payload.comment ?? null,
      dueAt,
      finalRecipientPartyId: finalRecipientExternal ? undefined : finalRecipientPartyId,
      finalRecipientExternal,
      stagingAttachmentIds: stagingIds,
    },
  );

  await client.query(
    `UPDATE tt_external_request_drafts
     SET confirmed_transfer_id = $2, step = 'done', idempotency_key = $3, updated_at = NOW()
     WHERE id = $1::uuid`,
    [input.draftId, publicCode, `native-staff:${input.draftId}`],
  );

  return { publicCode };
}

export async function confirmNativeExternalDraft(
  client: PoolClient,
  input: {
    personId: string;
    externalPartyId: string;
    draftId: string;
  },
): Promise<{ publicCode: string }> {
  return confirmExternalRequestDraft(client, {
    personId: input.personId,
    externalPartyId: input.externalPartyId,
    draftId: input.draftId,
    idempotencyKey: `native-ext:${input.draftId}`,
  });
}
