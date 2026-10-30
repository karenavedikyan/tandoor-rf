import type { PoolClient } from "pg";
import { lockTanbotTelegramLkUser, lockTanbotMaxLkUser } from "../tanbot/link-advisory-locks";
import { findAccountByTelegramUserId, cancelActiveLinkAttempts, insertLinkAudit } from "../tanbot-telegram/link-repository";
import {
  findAccountByMaxUserId,
  cancelActiveLinkAttempts as cancelMaxLinkAttempts,
  insertLinkAudit as insertMaxLinkAudit,
} from "../tanbot-max/link-repository";
import {
  externalMessengerStopReply,
  revokeExternalPersonMessengerChannel,
} from "../tan-tracker/external-person/channel-revocation";

async function disconnectStaffTelegramOnClient(client: PoolClient, userId: string): Promise<void> {
  await lockTanbotTelegramLkUser(client, userId);
  await client.query(
    `UPDATE tanbot_telegram_accounts SET stopped_at = NOW(), notifications_enabled = FALSE WHERE user_id = $1::uuid`,
    [userId],
  );
  await cancelActiveLinkAttempts(client, userId);
  await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
}

async function disconnectStaffMaxOnClient(client: PoolClient, userId: string): Promise<void> {
  await lockTanbotMaxLkUser(client, userId);
  await client.query(
    `UPDATE tanbot_max_accounts SET stopped_at = NOW(), notifications_enabled = FALSE WHERE user_id = $1::uuid`,
    [userId],
  );
  await cancelMaxLinkAttempts(client, userId);
  await insertMaxLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
}

export async function handleStaffOrExternalMessengerStop(
  client: PoolClient,
  input: { channel: "telegram" | "max"; messengerUserId: bigint },
): Promise<string> {
  if (input.channel === "telegram") {
    const account = await findAccountByTelegramUserId(client, input.messengerUserId);
    if (account) {
      await disconnectStaffTelegramOnClient(client, account.user_id);
      return "Уведомления Telegram отключены. Включить снова можно в личном кабинете.";
    }
  } else {
    const account = await findAccountByMaxUserId(client, input.messengerUserId);
    if (account) {
      await disconnectStaffMaxOnClient(client, account.user_id);
      return "Уведомления MAX отключены. Включить снова можно в личном кабинете.";
    }
  }

  const revoked = await revokeExternalPersonMessengerChannel(client, {
    channel: input.channel,
    messengerUserId: input.messengerUserId,
  });
  if (revoked.personId) {
    return externalMessengerStopReply(input.channel);
  }

  return input.channel === "max"
    ? "MAX не подключён. Подключение сотрудника — в личном кабинете; внешние передачи — по ссылке из бота."
    : "Telegram не подключён. Подключение сотрудника — в личном кабинете; внешние передачи — по ссылке из бота.";
}
