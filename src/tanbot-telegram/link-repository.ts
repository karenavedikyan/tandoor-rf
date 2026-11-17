import type { PoolClient } from "pg";

export type LinkAttemptRow = {
  phone_e164: string | null;
  enable_notifications: boolean;
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  cancelled_at: Date | null;
  telegram_user_id: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_started_at: Date | null;
  confirmed_at: Date | null;
};

export async function cancelActiveLinkAttempts(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE tanbot_telegram_link_attempts
     SET cancelled_at = NOW()
     WHERE user_id = $1::uuid AND consumed_at IS NULL AND cancelled_at IS NULL`,
    [userId],
  );
}

export async function insertLinkAttempt(
  client: PoolClient,
  input: { userId: string; tokenHash: string; expiresAt: Date; phone?: string | null; enableNotifications?: boolean },
): Promise<{ id: string }> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO tanbot_telegram_link_attempts (user_id, token_hash, expires_at, phone_e164, enable_notifications)
     VALUES ($1::uuid, $2, $3, $4, $5)
     RETURNING id::text`,
    [input.userId, input.tokenHash, input.expiresAt, input.phone ?? null, input.enableNotifications !== false],
  );
  return { id: row.rows[0]!.id };
}

export async function findLinkAttemptByTokenHash(
  client: PoolClient,
  tokenHash: string,
): Promise<LinkAttemptRow | null> {
  const row = await client.query<LinkAttemptRow>(
    `SELECT phone_e164,enable_notifications,id::text, user_id::text, token_hash, expires_at, consumed_at, cancelled_at,
            telegram_user_id::text, telegram_chat_id::text, telegram_username, telegram_first_name,
            telegram_started_at, confirmed_at
     FROM tanbot_telegram_link_attempts
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  return row.rows[0] ?? null;
}

export async function lockLinkAttemptByTokenHash(
  client: PoolClient,
  tokenHash: string,
): Promise<LinkAttemptRow | null> {
  const row = await client.query<LinkAttemptRow>(
    `SELECT phone_e164,enable_notifications,id::text, user_id::text, token_hash, expires_at, consumed_at, cancelled_at,
            telegram_user_id::text, telegram_chat_id::text, telegram_username, telegram_first_name,
            telegram_started_at, confirmed_at
     FROM tanbot_telegram_link_attempts
     WHERE token_hash = $1
     FOR UPDATE`,
    [tokenHash],
  );
  return row.rows[0] ?? null;
}

export async function findPendingLinkAttemptForUser(
  client: PoolClient,
  userId: string,
): Promise<LinkAttemptRow | null> {
  const row = await client.query<LinkAttemptRow>(
    `SELECT phone_e164,enable_notifications,id::text, user_id::text, token_hash, expires_at, consumed_at, cancelled_at,
            telegram_user_id::text, telegram_chat_id::text, telegram_username, telegram_first_name,
            telegram_started_at, confirmed_at
     FROM tanbot_telegram_link_attempts
     WHERE user_id = $1::uuid
       AND consumed_at IS NULL AND cancelled_at IS NULL
       AND telegram_user_id IS NOT NULL
       AND expires_at > NOW()
     ORDER BY telegram_started_at DESC NULLS LAST
     LIMIT 1`,
    [userId],
  );
  return row.rows[0] ?? null;
}

export async function attachTelegramToLinkAttempt(
  client: PoolClient,
  input: {
    attemptId: string;
    telegramUserId: bigint;
    telegramChatId: bigint;
    telegramUsername: string | null;
    telegramFirstName: string | null;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE tanbot_telegram_link_attempts
     SET telegram_user_id = $2,
         telegram_chat_id = $3,
         telegram_username = $4,
         telegram_first_name = $5,
         telegram_started_at = COALESCE(telegram_started_at, NOW())
     WHERE id = $1::uuid
       AND consumed_at IS NULL
       AND cancelled_at IS NULL
       AND expires_at > NOW()
       AND (telegram_user_id IS NULL OR telegram_user_id = $2)`,
    [
      input.attemptId,
      input.telegramUserId.toString(),
      input.telegramChatId.toString(),
      input.telegramUsername,
      input.telegramFirstName,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findAccountByTelegramUserId(
  client: PoolClient,
  telegramUserId: bigint,
): Promise<{ user_id: string; notifications_enabled: boolean; phone_e164: string | null } | null> {
  const row = await client.query<{ user_id: string; notifications_enabled: boolean; phone_e164: string | null }>(
    `SELECT user_id::text, notifications_enabled, phone_e164 FROM tanbot_telegram_all_accounts
     WHERE telegram_user_id = $1 AND stopped_at IS NULL`,
    [telegramUserId.toString()],
  );
  return row.rows[0] ?? null;
}

export async function findTelegramAccountByMessengerIdIncludingStopped(
  client: PoolClient,
  telegramUserId: bigint,
): Promise<{
  user_id: string;
  telegram_user_id: string;
  notifications_enabled: boolean;
  stopped_at: Date | null;
} | null> {
  const row = await client.query(
    `SELECT user_id::text, telegram_user_id::text, notifications_enabled, stopped_at
     FROM tanbot_telegram_all_accounts WHERE telegram_user_id = $1 LIMIT 1`,
    [telegramUserId.toString()],
  );
  return row.rows[0] ?? null;
}

export async function findAccountByUserId(
  client: PoolClient,
  userId: string,
  messengerUserId?: string | null,
): Promise<{
  user_id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  notifications_enabled: boolean;
  stopped_at: Date | null;
} | null> {
  const row = await client.query(
    `SELECT user_id::text, telegram_user_id::text, telegram_username, notifications_enabled, stopped_at
     FROM tanbot_telegram_all_accounts WHERE user_id = $1::uuid
       AND (($2::bigint IS NULL AND is_primary) OR telegram_user_id=$2::bigint) LIMIT 1`,
    [userId, messengerUserId ?? null],
  );
  return row.rows[0] ?? null;
}

export async function insertLinkAudit(
  client: PoolClient,
  input: { userId: string | null; actorUserId: string | null; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO tanbot_telegram_link_audit (user_id, actor_user_id, action, detail)
     VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)`,
    [input.userId, input.actorUserId, input.action, JSON.stringify(input.detail ?? {})],
  );
}
