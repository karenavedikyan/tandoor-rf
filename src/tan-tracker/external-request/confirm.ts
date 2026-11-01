import type { PoolClient } from "pg";
import { nextPublicTransferCode } from "../repository";
import {
  countOpenExternalRequests,
  hasPriorTransferRelationship,
  MAX_OPEN_EXTERNAL_REQUESTS,
  staffUserAcceptsExternalIntake,
  isActiveStaffUser,
} from "./intake";
import { notifyExternalCreatedStaff, notifyTransferAssignment } from "../transfer-lk-notify";
import { externalRequestDueAtFromMode } from "./due-at-msk";
import { notifyAdminsOfNewTrack } from "../admin-overview";

export type ExternalDraftPayload = {
  item?: string;
  comment?: string;
  recipientUserId?: string;
  recipientChoices?: string[];
  dueMode?: "today" | "tomorrow" | "none";
  draftOrigin?: "web" | "native_bot";
};

export async function confirmExternalRequestDraft(
  client: PoolClient,
  input: {
    personId: string;
    externalPartyId: string;
    draftId: string;
    idempotencyKey: string;
  },
): Promise<{ transferId: string; publicCode: string }> {
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
      payload: ExternalDraftPayload;
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
    const existing = await client.query<{ id: string; public_code: string }>(
      `SELECT id, public_code FROM tt_transfers WHERE id = $1 LIMIT 1`,
      [draft.confirmed_transfer_id],
    );
    if (existing.rows[0]) {
      return { transferId: existing.rows[0].id, publicCode: existing.rows[0].public_code };
    }
  }
  if (draft.idempotency_key === input.idempotencyKey && draft.confirmed_transfer_id) {
    const existing = await client.query<{ id: string; public_code: string }>(
      `SELECT id, public_code FROM tt_transfers WHERE id = $1 LIMIT 1`,
      [draft.confirmed_transfer_id],
    );
    if (existing.rows[0]) {
      return { transferId: existing.rows[0].id, publicCode: existing.rows[0].public_code };
    }
  }

  const open = await countOpenExternalRequests(client, input.externalPartyId);
  if (open >= MAX_OPEN_EXTERNAL_REQUESTS) {
    throw Object.assign(new Error("Достигнут лимит открытых заявок (5)."), { http: 409 });
  }

  const payload = draft.payload ?? {};
  const item = String(payload.item ?? "").trim();
  const recipientUserId = String(payload.recipientUserId ?? "").trim();
  if (!item || !recipientUserId) {
    throw Object.assign(new Error("Заполните все шаги заявки."), { http: 409 });
  }
  if (!(await isActiveStaffUser(client, recipientUserId))) {
    throw Object.assign(new Error("Сотрудник недоступен."), { http: 403 });
  }
  const intakeOk = await staffUserAcceptsExternalIntake(client, recipientUserId);
  const related = await hasPriorTransferRelationship(client, input.externalPartyId, recipientUserId);
  if (!intakeOk && !related) {
    throw Object.assign(new Error("Выбранный сотрудник недоступен для заявки."), { http: 403 });
  }
  const staffParty = (
    await client.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE user_id = $1::uuid LIMIT 1`, [
      recipientUserId,
    ])
  ).rows[0];
  if (!staffParty) throw Object.assign(new Error("Сотрудник недоступен."), { http: 403 });

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
      staffParty.id,
      dueAt,
    ],
  );
  await client.query(
    `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note)
     VALUES ($1,$2,$3,$4)`,
    [publicCode, input.externalPartyId, staffParty.id, "Заявка от внешнего клиента"],
  );
  await client.query(
    `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
     VALUES ($1,1,$2,$3,$4)`,
    [publicCode, input.externalPartyId, staffParty.id, item],
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
    [input.draftId, input.idempotencyKey, publicCode, input.personId],
  );
  await notifyExternalCreatedStaff(client, {
    transferId: publicCode,
    staffUserId: recipientUserId,
    itemTitle: item,
    publicCode,
    handoffVersion: 1,
    externalPartyId: input.externalPartyId,
    staffPartyId: staffParty.id,
  });
  await notifyTransferAssignment(client, {
    transferId: publicCode,
    publicCode,
    itemTitle: item,
    holderUserId: recipientUserId,
    holderPartyId: staffParty.id,
    fromPartyId: input.externalPartyId,
    handoffVersion: 1,
  });
  await notifyAdminsOfNewTrack(client, publicCode);
  return { transferId: publicCode, publicCode };
}
