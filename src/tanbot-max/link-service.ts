import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../access/db";
import type { TanbotMaxStage2Config } from "./stage2-config";
import {
  assertLkUserActiveForTanbotLink,
  lockTanbotMaxLkUser,
  lockTanbotMaxMessenger,
} from "../tanbot/link-advisory-locks";
import {
  attachMaxToLinkAttempt,
  cancelActiveLinkAttempts,
  findAccountByMaxUserId,
  findAccountByUserId,
  findLinkAttemptByTokenHash,
  findMaxAccountByMessengerIdIncludingStopped,
  findPendingLinkAttemptForUser,
  insertLinkAttempt,
  insertLinkAudit,
  lockLinkAttemptByTokenHash,
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
    await lockTanbotMaxLkUser(client, userId);
    await assertLkUserActiveForTanbotLink(client, userId);
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

async function finalizeMaxLinkAttemptOnClient(
  client: PoolClient,
  attemptId: string,
  userId: string,
  options: { enableNotifications: boolean; preserveNotificationPreference?: boolean },
): Promise<{ notificationsEnabled: boolean }> {
  await lockTanbotMaxLkUser(client, userId);
  await assertLkUserActiveForTanbotLink(client, userId);

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
  await lockTanbotMaxMessenger(client, maxUserId);

  const ownRow = await findAccountByUserId(client, userId);
  if (ownRow && !ownRow.stopped_at && ownRow.max_user_id !== attempt.max_user_id) {
    throw Object.assign(new Error("Сначала отключите текущий MAX в профиле."), { http: 409 });
  }

  const messengerRow = await findMaxAccountByMessengerIdIncludingStopped(client, maxUserId);
  if (messengerRow && messengerRow.user_id !== userId) {
    throw Object.assign(new Error("Этот MAX уже привязан к другому сотруднику."), { http: 409 });
  }

  const preserve = options.preserveNotificationPreference === true;
  const nextNotifications =
    preserve && messengerRow && messengerRow.user_id === userId
      ? messengerRow.notifications_enabled
      : options.enableNotifications;

  if (ownRow || messengerRow) {
    const updated = await client.query<{ notifications_enabled: boolean }>(
      `UPDATE tanbot_max_accounts
       SET max_user_id = $2,
           max_chat_id = $3,
           max_username = $4,
           notifications_enabled = $5,
           stopped_at = NULL,
           linked_at = NOW()
       WHERE user_id = $1::uuid
       RETURNING notifications_enabled`,
      [userId, attempt.max_user_id, attempt.max_chat_id, attempt.max_username, nextNotifications],
    );
    if (!updated.rowCount) {
      throw Object.assign(new Error("Не удалось обновить привязку MAX."), { http: 409 });
    }
  } else {
    await client.query(
      `INSERT INTO tanbot_max_accounts (user_id, max_user_id, max_chat_id, max_username, notifications_enabled, stopped_at)
       VALUES ($1::uuid, $2, $3, $4, $5, NULL)`,
      [userId, attempt.max_user_id, attempt.max_chat_id, attempt.max_username, nextNotifications],
    );
  }

  await client.query(
    `UPDATE tanbot_max_link_attempts SET consumed_at = NOW(), confirmed_at = NOW() WHERE id = $1::uuid`,
    [attemptId],
  );
  return { notificationsEnabled: nextNotifications };
}

export async function confirmTanbotMaxLink(
  pool: Pool,
  userId: string,
  attemptId: string,
  options: { enableNotifications?: boolean } = {},
): Promise<{ linked: true }> {
  const enableNotifications = options.enableNotifications === true;
  await withTransaction(async (client) => {
    await finalizeMaxLinkAttemptOnClient(client, attemptId, userId, { enableNotifications });
    await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_confirm", detail: { attemptId } });
  });
  return { linked: true };
}

export async function disconnectTanbotMaxLink(pool: Pool, userId: string): Promise<void> {
  await withTransaction(async (client) => {
    await lockTanbotMaxLkUser(client, userId);
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

function idempotentMaxLinkedReplayForConsumedAttempt(
  attempt: {
    consumed_at: Date | null;
    user_id: string;
    max_user_id: string | null;
  },
  maxUserId: bigint,
  account: { user_id: string } | null,
): "linked" | "invalid" | null {
  if (!attempt.consumed_at) return null;
  if (!attempt.max_user_id || attempt.max_user_id !== maxUserId.toString()) {
    return "invalid";
  }
  if (account && account.user_id === attempt.user_id) {
    return "linked";
  }
  return "invalid";
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
): Promise<"linked" | "invalid" | "conflict"> {
  const tokenHash = hashLinkStartToken(input.startToken, config.linkTokenPepper);
  const run = async (client: PoolClient) => {
    const peek = await findLinkAttemptByTokenHash(client, tokenHash);
    if (!peek) {
      return "invalid";
    }
    await lockTanbotMaxLkUser(client, peek.user_id);

    const attempt = await lockLinkAttemptByTokenHash(client, tokenHash);
    if (!attempt || attempt.user_id !== peek.user_id) {
      return "invalid";
    }

    const existingAccount = await findAccountByMaxUserId(client, input.maxUserId);
    const replay = idempotentMaxLinkedReplayForConsumedAttempt(attempt, input.maxUserId, existingAccount);
    if (replay) {
      return replay;
    }

    if (attempt.consumed_at || attempt.cancelled_at || attempt.expires_at.getTime() <= Date.now()) {
      return "invalid";
    }
    if (existingAccount && existingAccount.user_id !== attempt.user_id) {
      return "conflict";
    }

    try {
      await assertLkUserActiveForTanbotLink(client, attempt.user_id);
    } catch {
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
    try {
      const alreadyActive =
        existingAccount &&
        existingAccount.user_id === attempt.user_id &&
        attempt.max_user_id === input.maxUserId.toString();
      await finalizeMaxLinkAttemptOnClient(client, attempt.id, attempt.user_id, {
        enableNotifications: true,
        preserveNotificationPreference: !!alreadyActive,
      });
    } catch (err: unknown) {
      const http = (err as { http?: number }).http;
      if (http === 409) return "conflict";
      throw err;
    }
    await insertLinkAudit(client, {
      userId: attempt.user_id,
      actorUserId: null,
      action: "link_confirm",
      detail: { attemptId: attempt.id, via: "max_start" },
    });
    return "linked";
  };
  if (existingClient) {
    return run(existingClient);
  }
  return withTransaction(run);
}
