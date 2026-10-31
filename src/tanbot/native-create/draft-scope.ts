import type { Pool, PoolClient } from "pg";
import type { ExternalDraftPayload } from "../../tan-tracker/external-request/confirm";
import {
  insertExternalRequestDraft,
  loadActiveExternalRequestDraft,
  type ExternalRequestDraftRow,
} from "../../tan-tracker/external-request/draft-store";
import { deleteAttachmentBytes } from "../../tan-tracker/attachments";

export type NativeCreateActorKind = "external" | "staff";

export function nativeBotDraftChatKey(input: {
  channel: "telegram" | "max";
  messengerChatId: string;
  actor: NativeCreateActorKind;
}): string {
  if (input.actor === "staff") {
    return `native:staff:${input.channel}:${input.messengerChatId}`;
  }
  return `native:ext:${input.channel}:${input.messengerChatId}`;
}

export type NativeCreateDraftPayload = ExternalDraftPayload & {
  draftOrigin: "native_bot";
  revision: number;
  actor: NativeCreateActorKind;
  staffUserId?: string;
  recipientPartyId?: string;
  recipientExternal?: { name: string; phone: string };
  recipientPage?: number;
  eligibleRecipients?: Array<{ userId: string; fullName: string }>;
  dueMode?: "today" | "tomorrow" | "none";
  editReturnStep?: string;
  recipientDisplayName?: string;
  recipientSearchQuery?: string;
  /** Distinct +7 options when a shared contact had multiple numbers (transient UI only). */
  recipientPhonePickOptions?: string[];
  /** Suggested name from last contact card (transient, not raw VCF). */
  recipientContactSuggestedName?: string;
  /** After contact-first: staff must confirm or replace name before phone step. */
  recipientExtAwaitNameConfirm?: boolean;
  /** User typed or explicitly replaced name (never overwrite from phone-step cards). */
  recipientNameManual?: boolean;
  /** Staff: name typed on unified recipient step before phone/contact (not an external draft step yet). */
  recipientPendingExternalName?: string;
  /** External actor: phone entered for intake; staff match deferred until Create. */
  externalRecipientPhone?: string;
  /** External actor: display name for summary (never staff profile). */
  externalRecipientDisplayName?: string;
  /** Provider-native media kind per attachment sort_order (image/file/video for resend). */
  nativeAttachmentTransportBySort?: Record<string, "image" | "file" | "video">;
};

export function clearExternalRecipientTarget(payload: NativeCreateDraftPayload): void {
  delete payload.recipientExternal;
  delete payload.recipientPhonePickOptions;
  delete payload.recipientContactSuggestedName;
  delete payload.recipientExtAwaitNameConfirm;
  delete payload.recipientNameManual;
  delete payload.recipientPendingExternalName;
  delete payload.externalRecipientPhone;
  delete payload.externalRecipientDisplayName;
}

export function clearStaffRecipientTarget(payload: NativeCreateDraftPayload): void {
  delete payload.recipientPartyId;
  delete payload.recipientUserId;
  delete payload.recipientDisplayName;
}

export function stripTransientRecipientDraftFields(payload: NativeCreateDraftPayload): void {
  delete payload.recipientPhonePickOptions;
  delete payload.recipientContactSuggestedName;
  delete payload.recipientExtAwaitNameConfirm;
}

type Db = Pool | PoolClient;

export async function loadNativeBotDraft(
  client: Db,
  channel: "telegram" | "max",
  messengerChatId: string,
  actor: NativeCreateActorKind,
  options: { forUpdate?: boolean } = {},
): Promise<ExternalRequestDraftRow | null> {
  const key = nativeBotDraftChatKey({ channel, messengerChatId, actor });
  const row = options.forUpdate
    ? await client.query<ExternalRequestDraftRow>(
        `SELECT id::text, step, payload, person_id::text
         FROM tt_external_request_drafts
         WHERE channel = $1 AND messenger_chat_id = $2 AND confirmed_transfer_id IS NULL
         ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
        [channel, key],
      )
    : null;
  const active = row?.rows[0] ?? (await loadActiveExternalRequestDraft(client, channel, key));
  if (!active) return null;
  const payload = active.payload as NativeCreateDraftPayload;
  if (payload?.draftOrigin !== "native_bot") return null;
  if (payload.actor !== actor) return null;
  return active;
}

export async function ensureNativeBotDraft(
  client: PoolClient,
  input: {
    channel: "telegram" | "max";
    messengerChatId: string;
    actor: NativeCreateActorKind;
    personId: string | null;
    staffUserId?: string;
    step?: string;
  },
): Promise<ExternalRequestDraftRow> {
  const existing = await loadNativeBotDraft(client, input.channel, input.messengerChatId, input.actor);
  if (existing) return existing;
  const key = nativeBotDraftChatKey({
    channel: input.channel,
    messengerChatId: input.messengerChatId,
    actor: input.actor,
  });
  const payload: NativeCreateDraftPayload = {
    draftOrigin: "native_bot",
    revision: 1,
    actor: input.actor,
    staffUserId: input.staffUserId,
  };
  return insertExternalRequestDraft(client, {
    channel: input.channel,
    messengerChatId: key,
    personId: input.personId,
    step: input.step ?? "item",
    payload,
  });
}

export async function discardNativeBotDraft(
  client: PoolClient,
  draftId: string,
): Promise<void> {
  const files = await client.query<{ storage_key: string }>(
    `SELECT storage_key FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draftId],
  );
  for (const row of files.rows) {
    await deleteAttachmentBytes(row.storage_key, client);
  }
  await client.query(`DELETE FROM tt_external_request_drafts WHERE id = $1::uuid`, [draftId]);
}

export async function bumpDraftRevision(
  client: PoolClient,
  draftId: string,
  step: string,
  payload: NativeCreateDraftPayload,
): Promise<NativeCreateDraftPayload> {
  const next: NativeCreateDraftPayload = { ...payload, revision: (payload.revision ?? 0) + 1 };
  await client.query(
    `UPDATE tt_external_request_drafts SET step = $2, payload = $3::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
    [draftId, step, JSON.stringify(next)],
  );
  return next;
}
