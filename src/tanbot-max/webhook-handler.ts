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
import type { MaxDeliveryTransport, MaxDeliveryResult, MaxInlineButton } from "./delivery-transport";
import { buildHandoffCodeBotReply } from "../tanbot/handoff-code-bot-flow";
import { isTanbotHandoffCodePilotEnabled } from "../tanbot/handoff-code-pilot-config";
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
  update: {
    dedupKey: string;
    updateType: string;
    maxUserId: bigint;
    chatId: bigint;
    startPayload: string | null;
    commandText: string | null;
    callbackPayload: string | null;
    username: string | null;
    firstName: string | null;
  },
): Promise<WebhookReply> {
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
    if (update.updateType === "bot_stopped" || update.commandText?.split(/\s+/)[0]?.toLowerCase() === "/stop") {
      const account = await findAccountByMaxUserId(client, update.maxUserId);
      if (account) {
        await disconnectMaxAccountOnClient(client, account.user_id);
      }
      reply = {
        userId: update.maxUserId,
        chatId: update.chatId,
        text: "Уведомления MAX отключены. Включить снова можно в личном кабинете.",
      };
    } else if (update.commandText?.split(/\s+/)[0]?.toLowerCase() === "/status") {
      const account = await findAccountByMaxUserId(client, update.maxUserId);
      reply = account
        ? {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "MAX подключён. Уведомления о передачах: включены в кабинете при активной подписке.",
          }
        : {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: "MAX не подключён к личному кабинету. Подключение выполняется в разделе «Мой профиль».",
          };
    } else if (update.updateType === "bot_started") {
      if (!update.startPayload) {
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: `Подключение MAX выполняется из личного кабинета Тандор.\nОткройте профиль: ${lkUrl}`,
        };
      } else {
        const outcome = await consumeStartTokenForMaxUser(
          pool,
          config,
          {
            startToken: update.startPayload,
            maxUserId: update.maxUserId,
            maxChatId: update.chatId,
            maxUsername: update.username,
            maxFirstName: update.firstName,
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
          reply = {
            userId: update.maxUserId,
            chatId: update.chatId,
            text: `Почти готово. Вернитесь в личный кабинет и подтвердите привязку MAX.\n${lkUrl}`,
          };
        }
      }
    } else if (
      isTanbotHandoffCodePilotEnabled() &&
      (update.updateType === "message_callback" ||
        update.callbackPayload ||
        update.commandText?.trim().toLowerCase() === "/code" ||
        update.commandText?.trim().toLowerCase() === "код")
    ) {
      const handoff = await buildHandoffCodeBotReply(client, "max", {
        externalUserId: update.maxUserId,
        callbackPayload: update.callbackPayload,
        commandText: update.commandText,
      });
      if (handoff.text) {
        reply = {
          userId: update.maxUserId,
          chatId: update.chatId,
          text: handoff.text,
          inlineButtons: handoff.maxInlineButtons,
        };
      }
    } else if (update.commandText) {
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
