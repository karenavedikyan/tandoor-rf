import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;
import type { ExternalDraftPayload } from "./confirm";
import { deleteAttachmentBytes } from "../attachments";

export type ExternalRequestDraftRow = {
  id: string;
  step: string;
  payload: ExternalDraftPayload;
  person_id: string | null;
};

/** Active (unconfirmed) draft for messenger chat, if any. */
export async function loadActiveExternalRequestDraft(
  client: Db,
  channel: "telegram" | "max",
  messengerChatId: string,
): Promise<ExternalRequestDraftRow | null> {
  const row = await client.query<ExternalRequestDraftRow>(
    `SELECT id::text, step, payload, person_id::text
     FROM tt_external_request_drafts
     WHERE channel = $1 AND messenger_chat_id = $2 AND confirmed_transfer_id IS NULL
     ORDER BY updated_at DESC
     LIMIT 1
     FOR UPDATE`,
    [channel, messengerChatId],
  );
  return row.rows[0] ?? null;
}

export async function insertExternalRequestDraft(
  client: PoolClient,
  input: {
    channel: "telegram" | "max";
    messengerChatId: string;
    personId: string | null;
    step: string;
    payload: ExternalDraftPayload;
  },
): Promise<ExternalRequestDraftRow> {
  const ins = await client.query<ExternalRequestDraftRow>(
    `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
     VALUES ($1, $2, $3::uuid, $4, $5::jsonb)
     RETURNING id::text, step, payload, person_id::text`,
    [input.channel, input.messengerChatId, input.personId, input.step, JSON.stringify(input.payload ?? {})],
  );
  return ins.rows[0]!;
}

/** Returns active draft or inserts a fresh row when the previous draft was confirmed. */
/**
 * Web-only fresh start: drop the caller's unconfirmed active draft for this chat and
 * delete linked blob bytes via deleteAttachmentBytes. Confirmed drafts are never loaded
 * as active. If blob delete fails, draft row deletion is skipped for that key batch;
 * orphaned blobs may remain until a separate retention path removes them (no global GC here).
 */
export async function discardActiveUnconfirmedDraftForWebFreshStart(
  client: PoolClient,
  input: {
    channel: "telegram" | "max";
    messengerChatId: string;
    personId: string;
  },
): Promise<{ discardedId: string | null }> {
  const active = await loadActiveExternalRequestDraft(client, input.channel, input.messengerChatId);
  if (!active) return { discardedId: null };
  if (input.messengerChatId.startsWith("native:")) {
    return { discardedId: null };
  }
  const origin = (active.payload as { draftOrigin?: string })?.draftOrigin;
  if (origin === "native_bot") {
    return { discardedId: null };
  }
  if (active.person_id && active.person_id !== input.personId) {
    const err = new Error("Черновик принадлежит другому профилю.") as Error & { http?: number };
    err.http = 403;
    throw err;
  }
  const confirmed = await client.query<{ confirmed_transfer_id: string | null }>(
    `SELECT confirmed_transfer_id FROM tt_external_request_drafts WHERE id = $1::uuid FOR UPDATE`,
    [active.id],
  );
  if (confirmed.rows[0]?.confirmed_transfer_id) {
    return { discardedId: null };
  }
  const files = await client.query<{ storage_key: string }>(
    `SELECT storage_key FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [active.id],
  );
  for (const row of files.rows) {
    await deleteAttachmentBytes(row.storage_key, client);
  }
  await client.query(`DELETE FROM tt_external_request_drafts WHERE id = $1::uuid`, [active.id]);
  return { discardedId: active.id };
}

export async function ensureActiveExternalRequestDraft(
  client: PoolClient,
  input: {
    channel: "telegram" | "max";
    messengerChatId: string;
    personId: string | null;
    step?: string;
    payload?: ExternalDraftPayload;
  },
): Promise<ExternalRequestDraftRow> {
  const active = await loadActiveExternalRequestDraft(client, input.channel, input.messengerChatId);
  if (active) return active;
  return insertExternalRequestDraft(client, {
    channel: input.channel,
    messengerChatId: input.messengerChatId,
    personId: input.personId,
    step: input.step ?? "item",
    payload: input.payload ?? {},
  });
}
