import type { PoolClient } from "pg";
import { changeMessengerAccount } from "./messenger-accounts";
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

async function disconnectStaffTelegramOnClient(client: PoolClient, userId: string, accountId: string): Promise<void> {
  await lockTanbotTelegramLkUser(client, userId);
  await changeMessengerAccount(client, { channel: "telegram", userId, accountId, disconnect: true });
  await cancelActiveLinkAttempts(client, userId);
  await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
}

async function disconnectStaffMaxOnClient(client: PoolClient, userId: string, accountId: string): Promise<void> {
  await lockTanbotMaxLkUser(client, userId);
  await changeMessengerAccount(client, { channel: "max", userId, accountId, disconnect: true });
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
      await disconnectStaffTelegramOnClient(client, account.user_id, input.messengerUserId.toString());
      return "Уведомления Telegram отключены. Чтобы подключиться снова, подтвердите свой номер кнопкой в боте.";
    }
  } else {
    const account = await findAccountByMaxUserId(client, input.messengerUserId);
    if (account) {
      await disconnectStaffMaxOnClient(client, account.user_id, input.messengerUserId.toString());
      return "Уведомления MAX отключены. Чтобы подключиться снова, подтвердите свой номер кнопкой в боте.";
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
    ? "MAX не подключён. Чтобы подключиться, откройте меню бота и подтвердите свой номер."
    : "Telegram не подключён. Чтобы подключиться, откройте меню бота и подтвердите свой номер.";
}
