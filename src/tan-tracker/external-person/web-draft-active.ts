import type { PoolClient } from "pg";
import { loadActiveExternalRequestDraft } from "../external-request/draft-store";

export type ExternalWebDraftLockRow = {
  id: string;
  person_id: string | null;
  confirmed_transfer_id: string | null;
  channel: string;
  messenger_chat_id: string;
};

/** Locks draft row and ensures it is the caller's current unconfirmed active draft for the chat. */
export async function lockExternalWebDraftForMutation(
  client: PoolClient,
  input: {
    draftId: string;
    personId: string;
    channel: "telegram" | "max";
    messengerChatId: string;
  },
): Promise<ExternalWebDraftLockRow> {
  const row = await client.query<ExternalWebDraftLockRow>(
    `SELECT id::text, person_id::text, confirmed_transfer_id, channel, messenger_chat_id
     FROM tt_external_request_drafts
     WHERE id = $1::uuid AND person_id = $2::uuid
     FOR UPDATE`,
    [input.draftId, input.personId],
  );
  const draft = row.rows[0];
  if (!draft) {
    const err = new Error("Черновик не найден.") as Error & { http?: number };
    err.http = 404;
    throw err;
  }
  if (draft.confirmed_transfer_id) {
    const err = new Error("Черновик уже отправлен.") as Error & { http?: number };
    err.http = 409;
    throw err;
  }
  if (draft.channel !== input.channel || draft.messenger_chat_id !== input.messengerChatId) {
    const err = new Error("Черновик недоступен.") as Error & { http?: number };
    err.http = 403;
    throw err;
  }
  const active = await loadActiveExternalRequestDraft(client, input.channel, input.messengerChatId);
  if (!active || active.id !== input.draftId) {
    const err = new Error("Черновик устарел. Начните заявку заново.") as Error & { http?: number };
    err.http = 409;
    throw err;
  }
  return draft;
}
