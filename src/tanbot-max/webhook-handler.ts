import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../access/db";
import type { TanbotMaxStage2Config } from "./stage2-config";
import { parseMaxWebhookUpdate } from "./update-parse";
import { consumeStartTokenForMaxUser } from "./link-service";
import {
  findAccountByMaxUserId,
  cancelActiveLinkAttempts,
  insertLinkAudit,
} from "./link-repository";
import { lockTanbotMaxLkUser } from "../tanbot/link-advisory-locks";
import { buildMessengerLinkSuccessReply, buildMessengerPlainStartReply } from "../tanbot/link-bot-replies";
import type { MaxDeliveryTransport, MaxDeliveryResult, MaxInlineButton } from "./delivery-transport";
import { buildHandoffCodeBotReply } from "../tanbot/handoff-code-bot-flow";
import { isTanbotHandoffCodePilotEnabled } from "../tanbot/handoff-code-pilot-config";
import { handleExternalRecipientMaxContact, handleExternalRecipientStart } from "../tanbot/external-recipient/bot-flow";
import type { MaxContactAttachmentPayload } from "../tanbot/external-recipient/max-contact-verify";
import { isExternalMessengerStartToken } from "../tan-tracker/external-messenger/start-token";
import {
  claimMaxUpdate,
  commitMaxUpdateReply,
  markMaxUpdateFailed,
} from "./webhook-inbox";
import { deliverMaxWebhookReply } from "./webhook-reply-delivery";

export type WebhookReply = {
  userId: bigint;
  chatId: bigint;
  text: string;
  inlineButtons?: MaxInlineButton[][];
} | null;

async function disconnectMaxAccountOnClient(client: PoolClient, userId: string): Promise<void> {
  await lockTanbotMaxLkUser(client, userId);
  await client.query(
    `UPDATE tanbot_max_accounts SET stopped_at = NOW(), notifications_enabled = FALSE WHERE user_id = $1::uuid`,
    [userId],
  );
  await cancelActiveLinkAttempts(client, userId);
  await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
}

async function processUpdateInTransaction(
  client: PoolClient,
  pool: Pool,
  config: TanbotMaxStage2Config,
  update: Record<string, unknown> & {
    dedupKey: string;
    updateType: string;
    maxUserId: bigint;
    chatId: bigint;
  },
): Promise<WebhookReply> {
  const startPayload = (update.startPayload as string | null) ?? null;
  const commandText = (update.commandText as string | null) ?? null;
  const callbackPayload = (update.callbackPayload as string | null) ?? null;
  const username = (update.username as string | null) ?? null;
  const firstName = (update.firstName as string | null) ?? null;
  const contact = update.contact as MaxContactAttachmentPayload | undefined;
  const isForwarded = Boolean(update.isForwarded);
  const claim = await claimMaxUpdate(client, update.dedupKey);
  if (claim.kind === "ignore") {
    return null;
  }
  if (claim.kind === "resend") {
    return claim.reply;
  }

  let reply: WebhookReply = null;
  const lkUrl = `${config.appOrigin}/profile`;

  try {
    if (contact) {
      const ext = await handleExternalRecipientMaxContact(client, {
        maxChatId: update.chatId,
        maxUserId: update.maxUserId,
        contact,
        isForwarded,
      });
      reply = ext
        ? {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: ext.text,
            inlineButtons: ext.requestContact
              ? [[{ type: "request_contact", text: "Отправить мой номер" }]]
              : undefined,
          }
        : { userId: update.maxUserId, chatId: update.chatId, text: "Контакт не принят." };
    } else if (update.updateType === "bot_stopped" || commandText?.split(/\s+/)[0]?.toLowerCase() === "/stop") {
      const account = await findAccountByMaxUserId(client, update.maxUserId);
      if (account) {
        await disconnectMaxAccountOnClient(client, account.user_id);
      }
      reply = {
        userId: update.maxUserId,
        chatId: update.chatId,
        text: "Уведомления MAX отключены. Включить снова можно в личном кабинете.",
      };
    } else if (commandText?.split(/\s+/)[0]?.toLowerCase() === "/status") {
      const account = await findAccountByMaxUserId(client, update.maxUserId);
      reply = account
        ? {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: account.notifications_enabled
              ? "MAX подключён. Уведомления о передачах Тан-трекера включены."
              : "MAX подключён. Уведомления о передачах выключены — включите в профиле.",
          }
        : {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "MAX не подключён к личному кабинету. Подключение выполняется в разделе «Мой профиль».",
          };
    } else if (update.updateType === "bot_started") {
      if (startPayload && isExternalMessengerStartToken(startPayload)) {
        const ext = await handleExternalRecipientStart(client, {
          channel: "max",
          startPayload,
          chatId: update.chatId,
          messengerUserId: update.maxUserId,
        });
        reply = ext
          ? {
              userId: update.maxUserId,
              chatId: update.chatId,
              text: ext.text,
              inlineButtons: ext.requestContact
                ? [[{ type: "request_contact", text: "Отправить мой номер" }]]
                : undefined,
            }
          : {
              userId: update.maxUserId,
              chatId: update.chatId,
              text: "Приглашение недоступно.",
            };
      } else if (!startPayload) {
        const account = await findAccountByMaxUserId(client, update.maxUserId);
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: buildMessengerPlainStartReply({
            channelLabel: "MAX",
            linked: !!account,
            notificationsEnabled: account?.notifications_enabled ?? false,
            profileUrl: lkUrl,
          }),
        };
      } else {
        const outcome = await consumeStartTokenForMaxUser(
          pool,
          config,
          {
            startToken: startPayload,
            maxUserId: update.maxUserId,
            maxChatId: update.chatId,
            maxUsername: username,
            maxFirstName: firstName,
          },
          client,
        );
        if (outcome === "conflict") {
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "Этот MAX уже связан с другим аккаунтом. Обратитесь к администратору.",
          };
        } else if (outcome === "invalid") {
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "Ссылка недействительна или истекла. Запросите новую в личном кабинете.",
          };
        } else {
          const account = await findAccountByMaxUserId(client, update.maxUserId);
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: buildMessengerLinkSuccessReply({
              channelLabel: "MAX",
              notificationsEnabled: account?.notifications_enabled ?? true,
            }),
          };
        }
      }
    } else if (
      isTanbotHandoffCodePilotEnabled() &&
      (update.updateType === "message_callback" ||
        callbackPayload ||
        commandText?.trim().toLowerCase() === "/code" ||
        commandText?.trim().toLowerCase() === "кod" ||
        commandText?.trim().toLowerCase() === "код")
    ) {
      const handoff = await buildHandoffCodeBotReply(client, "max", {
        externalUserId: update.maxUserId,
        callbackPayload,
        commandText,
      });
      if (handoff.text) {
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: handoff.text,
          inlineButtons: handoff.maxInlineButtons,
        };
      }
    } else if (commandText) {
      reply = {
        userId: update.maxUserId,
        chatId: update.chatId,
        text: "Команды: /status — статус, /stop — отключить уведомления, /code — код приёма.",
      };
    }

    await commitMaxUpdateReply(client, update.dedupKey, reply);
    return reply;
  } catch (err) {
    await markMaxUpdateFailed(client, update.dedupKey);
    throw err;
  }
}

export async function handleTanbotMaxUpdate(
  pool: Pool,
  config: TanbotMaxStage2Config,
  raw: unknown,
): Promise<{ reply: WebhookReply; dedupKey: string | null }> {
  const parsed = parseMaxWebhookUpdate(raw);
  if (!parsed.ok) {
    return { reply: null, dedupKey: null };
  }
  const { update } = parsed;
  const reply = await withTransaction((client) => processUpdateInTransaction(client, pool, config, update));
  return { reply, dedupKey: update.dedupKey };
}

export async function maybeSendMaxWebhookReply(
  pool: Pool,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport | null,
  dedupKey: string | null,
  reply: WebhookReply,
): Promise<MaxDeliveryResult | null> {
  if (!reply || !transport || !config.deliveryEnabled || dedupKey == null) return null;
  return deliverMaxWebhookReply(pool, config, transport, dedupKey, reply);
}
