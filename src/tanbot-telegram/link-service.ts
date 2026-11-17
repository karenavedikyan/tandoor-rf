import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../access/db";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import { changeMessengerAccount, messengerProfileStatus, saveMessengerAccount, validateAccountPhone } from "../tanbot/messenger-accounts";
import {
  assertLkUserActiveForTanbotLink,
  lockTanbotTelegramLkUser,
  lockTanbotTelegramMessenger,
} from "../tanbot/link-advisory-locks";
import {
  attachTelegramToLinkAttempt,
  cancelActiveLinkAttempts,
  findAccountByTelegramUserId,
  findAccountByUserId,
  findLinkAttemptByTokenHash,
  findPendingLinkAttemptForUser,
  findTelegramAccountByMessengerIdIncludingStopped,
  insertLinkAttempt,
  insertLinkAudit,
  lockLinkAttemptByTokenHash,
} from "./link-repository";
import { buildTelegramDeepLink, generateLinkStartToken, hashLinkStartToken } from "./link-tokens";

export type LinkStatusDto = {
  accounts: Awaited<ReturnType<typeof messengerProfileStatus>>["accounts"];
  profilePhones: string[];
  linked: boolean;
  notificationsEnabled: boolean;
  telegramUsername: string | null;
  pendingConfirmation: {
    attemptId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    expiresAt: string;
  } | null;
  botUsername: string;
  integrationEnabled: boolean;
};

export async function getTanbotLinkStatus(
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
      ...await messengerProfileStatus(client, "telegram", userId),
      linked,
      notificationsEnabled: linked ? account!.notifications_enabled : false,
      telegramUsername: linked ? account!.telegram_username : null,
      pendingConfirmation: pending
        ? {
            attemptId: pending.id,
            telegramUsername: pending.telegram_username,
            telegramFirstName: pending.telegram_first_name,
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

export async function startTanbotLink(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  userId: string,
  options: { phone?: string | null; enableNotifications?: boolean } = {},
): Promise<{ deepLink: string; expiresAt: string; attemptId: string }> {
  const token = generateLinkStartToken();
  const tokenHash = hashLinkStartToken(token, config.linkTokenPepper);
  const expiresAt = new Date(Date.now() + config.linkTokenTtlMinutes * 60_000);

  const attemptId = await withTransaction(async (client) => {
    await lockTanbotTelegramLkUser(client, userId);
    await assertLkUserActiveForTanbotLink(client, userId);
    const phone = await validateAccountPhone(client, userId, options.phone);
    await cancelActiveLinkAttempts(client, userId);
    const inserted = await insertLinkAttempt(client, { userId, tokenHash, expiresAt, phone,
      enableNotifications: options.enableNotifications });
    await insertLinkAudit(client, {
      userId,
      actorUserId: userId,
      action: "link_start",
      detail: { attemptId: inserted.id },
    });
    return inserted.id;
  });

  return {
    deepLink: buildTelegramDeepLink(config.botUsername, token),
    expiresAt: expiresAt.toISOString(),
    attemptId,
  };
}

async function finalizeTelegramLinkAttemptOnClient(
  client: PoolClient,
  attemptId: string,
  userId: string,
  options: { enableNotifications: boolean; preserveNotificationPreference?: boolean },
): Promise<{ notificationsEnabled: boolean }> {
  await lockTanbotTelegramLkUser(client, userId);
  await assertLkUserActiveForTanbotLink(client, userId);

  const attemptRow = await client.query(
    `SELECT phone_e164,id::text, user_id::text, expires_at, consumed_at, cancelled_at,
            telegram_user_id::text, telegram_chat_id::text, telegram_username
     FROM tanbot_telegram_link_attempts
     WHERE id = $1::uuid
     FOR UPDATE`,
    [attemptId],
  );
  const attempt = attemptRow.rows[0] as
    | {
        id: string;
        phone_e164: string | null;
        user_id: string;
        expires_at: Date;
        consumed_at: Date | null;
        cancelled_at: Date | null;
        telegram_user_id: string | null;
        telegram_chat_id: string | null;
        telegram_username: string | null;
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
  if (!attempt.telegram_user_id || !attempt.telegram_chat_id) {
    throw Object.assign(new Error("Сначала откройте бота в Telegram по ссылке."), { http: 409 });
  }

  const tgUserId = BigInt(attempt.telegram_user_id);
  await lockTanbotTelegramMessenger(client, tgUserId);

  const messengerRow = await findTelegramAccountByMessengerIdIncludingStopped(client, tgUserId);
  if (messengerRow && messengerRow.user_id !== userId) {
    throw Object.assign(new Error("Этот Telegram уже привязан к другому сотруднику."), { http: 409 });
  }

  const preserve = options.preserveNotificationPreference === true;
  const nextNotifications =
    preserve && messengerRow && messengerRow.user_id === userId
      ? messengerRow.notifications_enabled
      : options.enableNotifications;

  const phone = await validateAccountPhone(client, userId, attempt.phone_e164);
  await saveMessengerAccount(client, { channel: "telegram", userId, messengerUserId: attempt.telegram_user_id,
    messengerChatId: attempt.telegram_chat_id, username: attempt.telegram_username, phone, enabled: nextNotifications });

  await client.query(
    `UPDATE tanbot_telegram_link_attempts SET consumed_at = NOW(), confirmed_at = NOW() WHERE id = $1::uuid`,
    [attemptId],
  );
  return { notificationsEnabled: nextNotifications };
}

export async function confirmTanbotLink(
  pool: Pool,
  userId: string,
  attemptId: string,
  options: { enableNotifications?: boolean } = {},
): Promise<{ linked: true }> {
  const enableNotifications = options.enableNotifications === true;
  await withTransaction(async (client) => {
    await finalizeTelegramLinkAttemptOnClient(client, attemptId, userId, { enableNotifications });
    await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_confirm", detail: { attemptId } });
  });
  return { linked: true };
}

export async function disconnectTanbotLink(pool: Pool, userId: string, accountId?: string): Promise<void> {
  await withTransaction(async (client) => {
    await lockTanbotTelegramLkUser(client, userId);
    await changeMessengerAccount(client, { channel: "telegram", userId, accountId, disconnect: true });
    await cancelActiveLinkAttempts(client, userId);
    await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
  });
}

export async function setTanbotNotificationsEnabled(pool: Pool, userId: string, enabled: boolean, accountId?: string): Promise<void> {
  await withTransaction(async (client) => {
    await lockTanbotTelegramLkUser(client, userId);
    await changeMessengerAccount(client, { channel: "telegram", userId, accountId, enabled });
    await insertLinkAudit(client, {
      userId,
      actorUserId: userId,
      action: enabled ? "notifications_on" : "notifications_off",
    });
  });
}

function idempotentLinkedReplayForConsumedAttempt(
  attempt: {
    consumed_at: Date | null;
    user_id: string;
    telegram_user_id: string | null;
  },
  telegramUserId: bigint,
  account: { user_id: string } | null,
): "linked" | "invalid" | null {
  if (!attempt.consumed_at) return null;
  if (!attempt.telegram_user_id || attempt.telegram_user_id !== telegramUserId.toString()) {
    return "invalid";
  }
  if (account && account.user_id === attempt.user_id) {
    return "linked";
  }
  return "invalid";
}

export async function consumeStartTokenForTelegramUser(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  input: {
    startToken: string;
    telegramUserId: bigint;
    telegramChatId: bigint;
    telegramUsername: string | null;
    telegramFirstName: string | null;
  },
  existingClient?: PoolClient,
): Promise<"linked" | "invalid" | "conflict"> {
  const tokenHash = hashLinkStartToken(input.startToken, config.linkTokenPepper);
  const run = async (client: PoolClient) => {
    const peek = await findLinkAttemptByTokenHash(client, tokenHash);
    if (!peek) {
      return "invalid";
    }
    await lockTanbotTelegramLkUser(client, peek.user_id);

    const attempt = await lockLinkAttemptByTokenHash(client, tokenHash);
    if (!attempt || attempt.user_id !== peek.user_id) {
      return "invalid";
    }

    const existingAccount = await findAccountByTelegramUserId(client, input.telegramUserId);
    const replay = idempotentLinkedReplayForConsumedAttempt(attempt, input.telegramUserId, existingAccount);
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

    const ok = await attachTelegramToLinkAttempt(client, {
      attemptId: attempt.id,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      telegramUsername: input.telegramUsername,
      telegramFirstName: input.telegramFirstName,
    });
    if (!ok) {
      return "invalid";
    }
    await insertLinkAudit(client, {
      userId: attempt.user_id,
      actorUserId: null,
      action: "telegram_start",
      detail: { attemptId: attempt.id },
    });
    try {
      const alreadyActive =
        existingAccount &&
        existingAccount.user_id === attempt.user_id &&
        attempt.telegram_user_id === input.telegramUserId.toString();
      await finalizeTelegramLinkAttemptOnClient(client, attempt.id, attempt.user_id, {
        enableNotifications: attempt.enable_notifications,
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
      detail: { attemptId: attempt.id, via: "telegram_start" },
    });
    return "linked";
  };
  if (existingClient) {
    return run(existingClient);
  }
  return withTransaction(run);
}
