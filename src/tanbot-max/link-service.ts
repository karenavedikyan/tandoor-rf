import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../access/db";
import type { TanbotMaxStage2Config } from "./stage2-config";
import {
  attachMaxToLinkAttempt,
  cancelActiveLinkAttempts,
  findAccountByMaxUserId,
  findAccountByUserId,
  findLinkAttemptByTokenHash,
  findPendingLinkAttemptForUser,
  insertLinkAttempt,
  insertLinkAudit,
} from "./link-repository";
import { buildMaxDeepLink, generateLinkStartToken, hashLinkStartToken } from "./link-tokens";

export type LinkStatusDto = {
  linked: boolean;
  notificationsEnabled: boolean;
  maxUsername: string | null;
  pendingConfirmation: {
    attemptId: string;
    maxUsername: string | null;
    maxFirstName: string | null;
    expiresAt: string;
  } | null;
  botUsername: string;
  integrationEnabled: boolean;
};

export async function getTanbotMaxLinkStatus(
  pool: Pool,
  userId: string,
  botUsername: string,
  flags: { integrationEnabled: boolean },
): Promise<LinkStatusDto> {
  const client = await pool.connect();
  try {
    const account = await findAccountByUserId(client, userId);
    const pending = await findPendingLinkAttemptForUser(client, userId);
    const linked = !!account && !account.stopped_at;
    return {
      linked,
      notificationsEnabled: linked ? account!.notifications_enabled : false,
      maxUsername: linked ? account!.max_username : null,
      pendingConfirmation: pending
        ? {
            attemptId: pending.id,
            maxUsername: pending.max_username,
            maxFirstName: pending.max_first_name,
            expiresAt: pending.expires_at.toISOString(),
          }
        : null,
      botUsername,
      integrationEnabled: flags.integrationEnabled,
    };
  } finally {
    client.release();
  }
}

export async function startTanbotMaxLink(
  pool: Pool,
  config: TanbotMaxStage2Config,
  userId: string,
): Promise<{ deepLink: string; expiresAt: string; attemptId: string }> {
  const token = generateLinkStartToken();
  const tokenHash = hashLinkStartToken(token, config.linkTokenPepper);
  const expiresAt = new Date(Date.now() + config.linkTokenTtlMinutes * 60_000);

  const attemptId = await withTransaction(async (client) => {
    const existing = await findAccountByUserId(client, userId);
    if (existing && !existing.stopped_at) {
      throw Object.assign(new Error("MAX уже подключён."), { http: 409 });
    }
    await cancelActiveLinkAttempts(client, userId);
    const inserted = await insertLinkAttempt(client, { userId, tokenHash, expiresAt });
    await insertLinkAudit(client, {
      userId,
      actorUserId: userId,
      action: "link_start",
      detail: { attemptId: inserted.id },
    });
    return inserted.id;
  });

  return {
    deepLink: buildMaxDeepLink(config.botUsername, token),
    expiresAt: expiresAt.toISOString(),
    attemptId,
  };
}

export async function confirmTanbotMaxLink(
  pool: Pool,
  userId: string,
  attemptId: string,
  options: { enableNotifications?: boolean } = {},
): Promise<{ linked: true }> {
  const enableNotifications = options.enableNotifications === true;
  await withTransaction(async (client) => {
    const attemptRow = await client.query(
      `SELECT id::text, user_id::text, expires_at, consumed_at, cancelled_at,
              max_user_id::text, max_chat_id::text, max_username
       FROM tanbot_max_link_attempts
       WHERE id = $1::uuid
       FOR UPDATE`,
      [attemptId],
    );
    const attempt = attemptRow.rows[0] as
      | {
          id: string;
          user_id: string;
          expires_at: Date;
          consumed_at: Date | null;
          cancelled_at: Date | null;
          max_user_id: string | null;
          max_chat_id: string | null;
          max_username: string | null;
        }
      | undefined;
    if (!attempt || attempt.user_id !== userId) {
      throw Object.assign(new Error("Попытка привязки не найдена."), { http: 404 });
    }
    if (attempt.consumed_at || attempt.cancelled_at) {
      throw Object.assign(new Error("Ссылка уже использована или отменена."), { http: 409 });
    }
    if (attempt.expires_at.getTime() <= Date.now()) {
      throw Object.assign(new Error("Срок ссылки истёк. Запросите новую."), { http: 409 });
    }
    if (!attempt.max_user_id || !attempt.max_chat_id) {
      throw Object.assign(new Error("Сначала откройте бота в MAX по ссылке."), { http: 409 });
    }

    const maxUserId = BigInt(attempt.max_user_id);
    await client.query(`SELECT pg_advisory_xact_lock(845002, hashtext($1::text))`, [maxUserId.toString()]);

    const other = await findAccountByMaxUserId(client, maxUserId);
    if (other && other.user_id !== userId) {
      throw Object.assign(new Error("Этот MAX уже привязан к другому сотруднику."), { http: 409 });
    }

    await client.query(`DELETE FROM tanbot_max_accounts WHERE user_id = $1::uuid`, [userId]);
    const inserted = await client.query<{ user_id: string }>(
      `INSERT INTO tanbot_max_accounts (user_id, max_user_id, max_chat_id, max_username, notifications_enabled, stopped_at)
       VALUES ($1::uuid, $2, $3, $4, $5, NULL)
       ON CONFLICT (max_user_id) DO UPDATE SET
         max_chat_id = EXCLUDED.max_chat_id,
         max_username = EXCLUDED.max_username,
         notifications_enabled = EXCLUDED.notifications_enabled,
         stopped_at = NULL,
         linked_at = NOW()
       WHERE tanbot_max_accounts.user_id = EXCLUDED.user_id
       RETURNING user_id::text`,
      [userId, attempt.max_user_id, attempt.max_chat_id, attempt.max_username, enableNotifications],
    );
    if (!inserted.rows[0] || inserted.rows[0].user_id !== userId) {
      throw Object.assign(new Error("Этот MAX уже привязан к другому сотруднику."), { http: 409 });
    }

    await client.query(
      `UPDATE tanbot_max_link_attempts SET consumed_at = NOW(), confirmed_at = NOW() WHERE id = $1::uuid`,
      [attemptId],
    );
    await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_confirm", detail: { attemptId } });
  });
  return { linked: true };
}

export async function disconnectTanbotMaxLink(pool: Pool, userId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE tanbot_max_accounts SET stopped_at = NOW(), notifications_enabled = FALSE WHERE user_id = $1::uuid`,
      [userId],
    );
    await cancelActiveLinkAttempts(client, userId);
    await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
  });
}

export async function setTanbotMaxNotificationsEnabled(pool: Pool, userId: string, enabled: boolean): Promise<void> {
  await withTransaction(async (client) => {
    const account = await findAccountByUserId(client, userId);
    if (!account || account.stopped_at) {
      throw Object.assign(new Error("MAX не подключён."), { http: 409 });
    }
    await client.query(
      `UPDATE tanbot_max_accounts SET notifications_enabled = $2 WHERE user_id = $1::uuid AND stopped_at IS NULL`,
      [userId, enabled],
    );
    await insertLinkAudit(client, {
      userId,
      actorUserId: userId,
      action: enabled ? "notifications_on" : "notifications_off",
    });
  });
}

export async function consumeStartTokenForMaxUser(
  pool: Pool,
  config: TanbotMaxStage2Config,
  input: {
    startToken: string;
    maxUserId: bigint;
    maxChatId: bigint;
    maxUsername: string | null;
    maxFirstName: string | null;
  },
  existingClient?: PoolClient,
): Promise<"pending_lk_confirm" | "invalid" | "conflict"> {
  const tokenHash = hashLinkStartToken(input.startToken, config.linkTokenPepper);
  const run = async (client: PoolClient) => {
    const existingAccount = await findAccountByMaxUserId(client, input.maxUserId);
    if (existingAccount) {
      return "conflict";
    }

    const attempt = await findLinkAttemptByTokenHash(client, tokenHash);
    if (!attempt || attempt.consumed_at || attempt.cancelled_at) {
      return "invalid";
    }
    if (attempt.expires_at.getTime() <= Date.now()) {
      return "invalid";
    }

    const ok = await attachMaxToLinkAttempt(client, {
      attemptId: attempt.id,
      maxUserId: input.maxUserId,
      maxChatId: input.maxChatId,
      maxUsername: input.maxUsername,
      maxFirstName: input.maxFirstName,
    });
    if (!ok) {
      return "invalid";
    }
    await insertLinkAudit(client, {
      userId: attempt.user_id,
      actorUserId: null,
      action: "max_start",
      detail: { attemptId: attempt.id },
    });
    return "pending_lk_confirm";
  };
  if (existingClient) {
    return run(existingClient);
  }
  return withTransaction(run);
}
