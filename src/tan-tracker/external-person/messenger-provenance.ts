import type { Pool, PoolClient } from "pg";

type PgQueryable = Pick<Pool, "query"> | PoolClient;

export type ExternalMessengerChannel = "telegram" | "max";

export type PersonMessengerProvenance = {
  channel: ExternalMessengerChannel;
  messengerChatId: string;
  messengerUserId: string;
};

/** Drafts and browser sessions must use the same messenger channel the person verified (no synthetic web channel). */
export async function requirePersonMessengerProvenance(
  client: PgQueryable,
  personId: string,
  preferred?: ExternalMessengerChannel,
): Promise<PersonMessengerProvenance> {
  const rows = await client.query<{
    channel: ExternalMessengerChannel;
    messenger_chat_id: string;
    messenger_user_id: string;
  }>(
    `SELECT channel, messenger_chat_id, messenger_user_id
     FROM tt_external_person_verifications
     WHERE person_id = $1::uuid
     ORDER BY CASE WHEN channel = $2 THEN 0 WHEN channel = 'telegram' THEN 1 ELSE 2 END, verified_at DESC`,
    [personId, preferred ?? "telegram"],
  );
  const row = rows.rows[0];
  if (!row) {
    throw Object.assign(new Error("Нет привязки мессенджера. Откройте ссылку из Telegram или MAX."), { http: 403 });
  }
  return {
    channel: row.channel,
    messengerChatId: row.messenger_chat_id,
    messengerUserId: row.messenger_user_id,
  };
}

export async function assertPersonHasVerificationChannel(
  client: PgQueryable,
  personId: string,
  channel: ExternalMessengerChannel,
): Promise<void> {
  const row = await client.query(
    `SELECT 1 FROM tt_external_person_verifications WHERE person_id = $1::uuid AND channel = $2 LIMIT 1`,
    [personId, channel],
  );
  if (!row.rowCount) {
    throw Object.assign(new Error("Сессия не соответствует каналу привязки."), { http: 403 });
  }
}
