import type { Pool } from "pg";
import type { PoolClient } from "pg";
import { withTransaction } from "../access/db";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import { parseTelegramWebhookUpdate } from "./update-parse";
import { consumeStartTokenForTelegramUser } from "./link-service";
import { findAccountByTelegramUserId, cancelActiveLinkAttempts, insertLinkAudit } from "./link-repository";
import type { TelegramDeliveryTransport, TelegramDeliveryResult } from "./delivery-transport";
import {
  claimTelegramUpdate,
  commitTelegramUpdateReply,
  markTelegramReplyDelivered,
  markTelegramUpdateFailed,
} from "./webhook-inbox";

export type WebhookReply = { chatId: bigint; text: string } | null;

async function disconnectTelegramAccountOnClient(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE tanbot_telegram_accounts SET stopped_at = NOW(), notifications_enabled = FALSE WHERE user_id = $1::uuid`,
    [userId],
  );
  await cancelActiveLinkAttempts(client, userId);
  await insertLinkAudit(client, { userId, actorUserId: userId, action: "link_disconnect" });
}

async function processUpdateInTransaction(
  client: PoolClient,
  pool: Pool,
  config: TanbotTelegramStage2Config,
  update: {
    updateId: number;
    telegramUserId: bigint;
    chatId: bigint;
    text: string;
    startPayload: string | null;
    username: string | null;
    firstName: string | null;
  },
): Promise<WebhookReply> {
  const claim = await claimTelegramUpdate(client, update.updateId);
  if (claim.kind === "ignore") {
    return null;
  }
  if (claim.kind === "resend") {
    return claim.reply;
  }

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
            text: "Telegram подключён. Уведомления о передачах: включены в кабинете при активной подписке.",
          }
        : {
            chatId: update.chatId,
            text: "Telegram не подключён к личному кабинету. Подключение выполняется в разделе «Мой профиль».",
          };
    } else if (command.startsWith("/start")) {
      const lkUrl = `${config.appOrigin}/profile`;
      if (!update.startPayload) {
        reply = {
          chatId: update.chatId,
          text: `Подключение Telegram выполняется из личного кабинета Тандор.\nОткройте профиль: ${lkUrl}`,
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
          reply = {
            chatId: update.chatId,
            text: `Почти готово. Вернитесь в личный кабинет и подтвердите привязку Telegram.\n${lkUrl}`,
          };
        }
      }
    } else {
      reply = {
        chatId: update.chatId,
        text: "Команды: /status — статус подключения, /stop — отключить уведомления.",
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
  const { update } = parsed;
  const reply = await withTransaction((client) =>
    processUpdateInTransaction(client, pool, config, update),
  );
  return { reply, updateId: update.updateId };
}

export async function maybeSendWebhookReply(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport | null,
  updateId: number | null,
  reply: WebhookReply,
): Promise<TelegramDeliveryResult | null> {
  if (!reply || !transport || !config.deliveryEnabled || updateId == null) return null;
  const result = await transport({
    method: "sendMessage",
    token: config.botToken,
    body: { chat_id: reply.chatId.toString(), text: reply.text },
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  if (result.ok) {
    await markTelegramReplyDelivered(pool, updateId);
  }
  return result;
}
