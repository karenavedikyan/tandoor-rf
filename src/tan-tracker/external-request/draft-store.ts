import type { PoolClient } from "pg";
import type { ExternalDraftPayload } from "./confirm";

export type ExternalRequestDraftRow = {
  id: string;
  step: string;
  payload: ExternalDraftPayload;
  person_id: string | null;
};

/** Active (unconfirmed) draft for messenger chat, if any. */
export async function loadActiveExternalRequestDraft(
  client: PoolClient,
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
