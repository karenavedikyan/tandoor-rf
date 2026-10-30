import type { Pool } from "pg";
import type { PoolClient } from "pg";
import { withTransaction } from "../access/db";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import { parseTelegramWebhookUpdate, type ParsedTelegramWebhookUpdate } from "./update-parse";
import { consumeStartTokenForTelegramUser } from "./link-service";
import { findAccountByTelegramUserId, cancelActiveLinkAttempts, insertLinkAudit } from "./link-repository";
import { lockTanbotTelegramLkUser } from "../tanbot/link-advisory-locks";
import { buildMessengerLinkSuccessReply, buildMessengerPlainStartReply } from "../tanbot/link-bot-replies";
import type { TelegramDeliveryTransport, TelegramDeliveryResult } from "./delivery-transport";
import {
  claimTelegramUpdate,
  commitTelegramUpdateReply,
  markTelegramUpdateFailed,
} from "./webhook-inbox";
import { deliverTelegramWebhookReply } from "./webhook-reply-delivery";
import { buildHandoffCodeBotReply } from "../tanbot/handoff-code-bot-flow";
import { isTanbotHandoffCodePilotEnabled } from "../tanbot/handoff-code-pilot-config";
import {
  handleExternalRecipientStart,
  handleExternalRecipientTelegramContact,
} from "../tanbot/external-recipient/bot-flow";
import { isExternalMessengerStartToken } from "../tan-tracker/external-messenger/start-token";

export type WebhookReply = {
  chatId: bigint;
  text: string;
  replyMarkup?: Record<string, unknown>;
  answerCallbackQueryId?: string;
} | null;

async function disconnectTelegramAccountOnClient(client: PoolClient, userId: string): Promise<void> {
  await lockTanbotTelegramLkUser(client, userId);
  await client.query(
    `UPDATE tanbot_telegram_accounts SET stopped_at = NOW(), notifications_enabled = FALSE WHERE user_id = $1::uuid`,
    [userId],
  );
  await cancelActiveLinkAttempts(client, userId);
  await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
}

async function processParsedUpdate(
  client: PoolClient,
  pool: Pool,
  config: TanbotTelegramStage2Config,
  parsed: ParsedTelegramWebhookUpdate,
): Promise<WebhookReply> {
  if (parsed.kind === "contact") {
    const update = parsed.update;
    const claim = await claimTelegramUpdate(client, update.updateId);
    if (claim.kind === "ignore") return null;
    if (claim.kind === "resend") return claim.reply;
    try {
      const ext = await handleExternalRecipientTelegramContact(client, {
        telegramChatId: update.chatId,
        telegramUserId: update.telegramUserId,
        contactUserId: update.contactUserId,
        phoneRaw: update.phoneNumber,
        isForwarded: update.isForwarded,
      });
      const reply: WebhookReply = ext
        ? {
            chatId: update.chatId,
            text: ext.text,
            replyMarkup: ext.requestContact
              ? {
                  keyboard: [[{ text: "Отправить мой номер", request_contact: true }]],
                  one_time_keyboard: true,
                  resize_keyboard: true,
                }
              : ext.clearContactKeyboard
                ? { remove_keyboard: true }
                : undefined,
          }
        : { chatId: update.chatId, text: "Контакт не принят." };
      await commitTelegramUpdateReply(client, update.updateId, reply);
      return reply;
    } catch (err) {
      await markTelegramUpdateFailed(client, update.updateId);
      throw err;
    }
  }

  if (parsed.kind === "callback") {
    const update = parsed.update;
    const claim = await claimTelegramUpdate(client, update.updateId);
    if (claim.kind === "ignore") return null;
    if (claim.kind === "resend") return claim.reply;
    try {
      let reply: WebhookReply = null;
      if (isTanbotHandoffCodePilotEnabled()) {
        const handoff = await buildHandoffCodeBotReply(client, "telegram", {
          externalUserId: update.telegramUserId,
          callbackPayload: update.callbackData,
        });
        if (handoff.text) {
          reply = {
            chatId: update.chatId,
            text: handoff.text,
            replyMarkup: handoff.telegramInlineKeyboard
              ? { inline_keyboard: handoff.telegramInlineKeyboard }
              : undefined,
            answerCallbackQueryId: update.callbackQueryId,
          };
        }
      }
      if (!reply) {
        reply = { chatId: update.chatId, text: "Действие недоступно.", answerCallbackQueryId: update.callbackQueryId };
      }
      await commitTelegramUpdateReply(client, update.updateId, reply);
      return reply;
    } catch (err) {
      await markTelegramUpdateFailed(client, update.updateId);
      throw err;
    }
  }

  const update = parsed.update;
  const claim = await claimTelegramUpdate(client, update.updateId);
  if (claim.kind === "ignore") return null;
  if (claim.kind === "resend") return claim.reply;

  let reply: WebhookReply = null;
  const command = update.text.split(/\s+/)[0]?.toLowerCase() ?? "";

  try {
    if (command === "/stop") {
      const account = await findAccountByTelegramUserId(client, update.telegramUserId);
      if (account) {
        await disconnectTelegramAccountOnClient(client, account.user_id);
      }
      reply = {
        chatId: update.chatId,
        text: "Уведомления Telegram отключены. Включить снова можно в личном кабинете.",
      };
    } else if (command === "/status") {
      const account = await findAccountByTelegramUserId(client, update.telegramUserId);
      reply = account
        ? {
            chatId: update.chatId,
            text: account.notifications_enabled
              ? "Telegram подключён. Уведомления о передачах Тан-трекера включены."
              : "Telegram подключён. Уведомления о передачах выключены — включите в профиле или /stop не отключает привязку.",
          }
        : {
            chatId: update.chatId,
            text: "Telegram не подключён к личному кабинету. Подключение выполняется в разделе «Мой профиль».",
          };
    } else if (command.startsWith("/start") && isExternalMessengerStartToken(update.startPayload)) {
      const ext = await handleExternalRecipientStart(client, {
        channel: "telegram",
        startPayload: update.startPayload,
        chatId: update.chatId,
        messengerUserId: update.telegramUserId,
      });
      reply = ext
        ? {
            chatId: update.chatId,
            text: ext.text,
            replyMarkup: ext.requestContact
              ? {
                  keyboard: [[{ text: "Отправить мой номер", request_contact: true }]],
                  one_time_keyboard: true,
                  resize_keyboard: true,
                }
              : undefined,
          }
        : { chatId: update.chatId, text: "Приглашение недоступно." };
    } else if (command.startsWith("/start")) {
      const lkUrl = `${config.appOrigin}/profile`;
      if (!update.startPayload) {
        const account = await findAccountByTelegramUserId(client, update.telegramUserId);
        reply = {
          chatId: update.chatId,
          text: buildMessengerPlainStartReply({
            channelLabel: "Telegram",
            linked: !!account,
            notificationsEnabled: account?.notifications_enabled ?? false,
            profileUrl: lkUrl,
          }),
        };
      } else {
        const outcome = await consumeStartTokenForTelegramUser(
          pool,
          config,
          {
            startToken: update.startPayload,
            telegramUserId: update.telegramUserId,
            telegramChatId: update.chatId,
            telegramUsername: update.username,
            telegramFirstName: update.firstName,
          },
          client,
        );
        if (outcome === "conflict") {
          reply = {
            chatId: update.chatId,
            text: "Этот Telegram уже связан с другим аккаунтом. Обратитесь к администратору.",
          };
        } else if (outcome === "invalid") {
          reply = {
            chatId: update.chatId,
            text: "Ссылка недействительна или истекла. Запросите новую в личном кабинете.",
          };
        } else {
          const account = await findAccountByTelegramUserId(client, update.telegramUserId);
          reply = {
            chatId: update.chatId,
            text: buildMessengerLinkSuccessReply({
              channelLabel: "Telegram",
              notificationsEnabled: account?.notifications_enabled ?? true,
            }),
          };
        }
      }
    } else if (isTanbotHandoffCodePilotEnabled() && (command === "/code" || command.startsWith("/code@"))) {
      const handoff = await buildHandoffCodeBotReply(client, "telegram", {
        externalUserId: update.telegramUserId,
        commandText: update.text,
      });
      if (handoff.text) {
        reply = {
          chatId: update.chatId,
          text: handoff.text,
          replyMarkup: handoff.telegramInlineKeyboard
            ? { inline_keyboard: handoff.telegramInlineKeyboard }
            : undefined,
        };
      }
    } else {
      reply = {
        chatId: update.chatId,
        text: "Команды: /status — статус, /stop — отключить уведомления, /code — код приёма.",
      };
    }
    await commitTelegramUpdateReply(client, update.updateId, reply);
    return reply;
  } catch (err) {
    await markTelegramUpdateFailed(client, update.updateId);
    throw err;
  }
}

export async function handleTanbotTelegramUpdate(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  raw: unknown,
): Promise<{ reply: WebhookReply; updateId: number | null }> {
  const parsed = parseTelegramWebhookUpdate(raw);
  if (!parsed.ok) {
    return { reply: null, updateId: null };
  }
  const reply = await withTransaction((client) => processParsedUpdate(client, pool, config, parsed.parsed));
  const updateId =
    parsed.parsed.kind === "message" ? parsed.parsed.update.updateId : parsed.parsed.update.updateId;
  return { reply, updateId };
}

export async function maybeSendWebhookReply(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport | null,
  updateId: number | null,
  reply: WebhookReply,
): Promise<TelegramDeliveryResult | null> {
  if (!reply || !transport || !config.deliveryEnabled || updateId == null) return null;
  return deliverTelegramWebhookReply(pool, config, transport, updateId, reply);
}
