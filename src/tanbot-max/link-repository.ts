import type { PoolClient } from "pg";

export type LinkAttemptRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  cancelled_at: Date | null;
  max_user_id: string | null;
  max_chat_id: string | null;
  max_username: string | null;
  max_first_name: string | null;
  max_started_at: Date | null;
  confirmed_at: Date | null;
};

export async function cancelActiveLinkAttempts(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE tanbot_max_link_attempts
     SET cancelled_at = NOW()
     WHERE user_id = $1::uuid AND consumed_at IS NULL AND cancelled_at IS NULL`,
    [userId],
  );
}

export async function insertLinkAttempt(
  client: PoolClient,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<{ id: string }> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO tanbot_max_link_attempts (user_id, token_hash, expires_at)
     VALUES ($1::uuid, $2, $3)
     RETURNING id::text`,
    [input.userId, input.tokenHash, input.expiresAt],
  );
  return { id: row.rows[0]!.id };
}

export async function findLinkAttemptByTokenHash(
  client: PoolClient,
  tokenHash: string,
): Promise<LinkAttemptRow | null> {
  const row = await client.query<LinkAttemptRow>(
    `SELECT id::text, user_id::text, token_hash, expires_at, consumed_at, cancelled_at,
            max_user_id::text, max_chat_id::text, max_username, max_first_name,
            max_started_at, confirmed_at
     FROM tanbot_max_link_attempts
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
    `SELECT id::text, user_id::text, token_hash, expires_at, consumed_at, cancelled_at,
            max_user_id::text, max_chat_id::text, max_username, max_first_name,
            max_started_at, confirmed_at
     FROM tanbot_max_link_attempts
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
    `SELECT id::text, user_id::text, token_hash, expires_at, consumed_at, cancelled_at,
            max_user_id::text, max_chat_id::text, max_username, max_first_name,
            max_started_at, confirmed_at
     FROM tanbot_max_link_attempts
     WHERE user_id = $1::uuid
       AND consumed_at IS NULL AND cancelled_at IS NULL
       AND max_user_id IS NOT NULL
       AND expires_at > NOW()
     ORDER BY max_started_at DESC NULLS LAST
     LIMIT 1`,
    [userId],
  );
  return row.rows[0] ?? null;
}

export async function attachMaxToLinkAttempt(
  client: PoolClient,
  input: {
    attemptId: string;
    maxUserId: bigint;
    maxChatId: bigint;
    maxUsername: string | null;
    maxFirstName: string | null;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE tanbot_max_link_attempts
     SET max_user_id = $2,
         max_chat_id = $3,
         max_username = $4,
         max_first_name = $5,
         max_started_at = COALESCE(max_started_at, NOW())
     WHERE id = $1::uuid
       AND consumed_at IS NULL
       AND cancelled_at IS NULL
       AND expires_at > NOW()
       AND (max_user_id IS NULL OR max_user_id = $2)`,
    [
      input.attemptId,
      input.maxUserId.toString(),
      input.maxChatId.toString(),
      input.maxUsername,
      input.maxFirstName,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findAccountByMaxUserId(
  client: PoolClient,
  maxUserId: bigint,
): Promise<{ user_id: string; notifications_enabled: boolean } | null> {
  const row = await client.query<{ user_id: string; notifications_enabled: boolean }>(
    `SELECT user_id::text, notifications_enabled FROM tanbot_max_accounts
     WHERE max_user_id = $1 AND stopped_at IS NULL`,
    [maxUserId.toString()],
  );
  return row.rows[0] ?? null;
}

export async function findAccountByUserId(
  client: PoolClient,
  userId: string,
): Promise<{
  user_id: string;
  max_user_id: string;
  max_username: string | null;
  notifications_enabled: boolean;
  stopped_at: Date | null;
} | null> {
  const row = await client.query(
    `SELECT user_id::text, max_user_id::text, max_username, notifications_enabled, stopped_at
     FROM tanbot_max_accounts WHERE user_id = $1::uuid`,
    [userId],
  );
  return row.rows[0] ?? null;
}

export async function insertLinkAudit(
  client: PoolClient,
  input: { userId: string | null; actorUserId: string | null; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO tanbot_max_link_audit (user_id, actor_user_id, action, detail)
     VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)`,
    [input.userId, input.actorUserId, input.action, JSON.stringify(input.detail ?? {})],
  );
}
