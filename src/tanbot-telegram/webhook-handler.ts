import type { Pool } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import { parseTelegramWebhookUpdate } from "./update-parse";
import {
  consumeStartTokenForTelegramUser,
  disconnectTanbotLink,
} from "./link-service";
import { findAccountByTelegramUserId } from "./link-repository";
import type { TelegramDeliveryTransport } from "./delivery-transport";

export type WebhookReply = { chatId: bigint; text: string } | null;

export async function recordUpdateDedup(pool: Pool, updateId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO tanbot_telegram_update_dedup (update_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [updateId],
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

export async function handleTanbotTelegramUpdate(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  raw: unknown,
  transport: TelegramDeliveryTransport | null,
): Promise<WebhookReply> {
  const parsed = parseTelegramWebhookUpdate(raw);
  if (!parsed.ok) {
    return null;
  }
  const { update } = parsed;
  const isNew = await recordUpdateDedup(pool, update.updateId);
  if (!isNew) {
    return null;
  }

  const command = update.text.split(/\s+/)[0]?.toLowerCase() ?? "";

  if (command === "/stop") {
    const client = await pool.connect();
    try {
      const account = await findAccountByTelegramUserId(client, update.telegramUserId);
      if (account) {
        await disconnectTanbotLink(pool, account.user_id);
      }
    } finally {
      client.release();
    }
    return {
      chatId: update.chatId,
      text: "Уведомления Telegram отключены. Включить снова можно в личном кабинете.",
    };
  }

  if (command === "/status") {
    const client = await pool.connect();
    try {
      const account = await findAccountByTelegramUserId(client, update.telegramUserId);
      if (!account) {
        return {
          chatId: update.chatId,
          text: "Telegram не подключён к личному кабинету. Подключение выполняется в разделе «Мой профиль».",
        };
      }
      return {
        chatId: update.chatId,
        text: "Telegram подключён. Уведомления о передачах: включены в кабинете при активной подписке.",
      };
    } finally {
      client.release();
    }
  }

  if (command.startsWith("/start")) {
    const lkUrl = `${config.appOrigin}/profile`;
    if (!update.startPayload) {
      return {
        chatId: update.chatId,
        text: `Подключение Telegram выполняется из личного кабинета Тандор.\nОткройте профиль: ${lkUrl}`,
      };
    }

    const outcome = await consumeStartTokenForTelegramUser(pool, config, {
      startToken: update.startPayload,
      telegramUserId: update.telegramUserId,
      telegramChatId: update.chatId,
      telegramUsername: update.username,
      telegramFirstName: update.firstName,
    });

    if (outcome === "conflict") {
      return {
        chatId: update.chatId,
        text: "Этот Telegram уже связан с другим аккаунтом. Обратитесь к администратору.",
      };
    }
    if (outcome === "invalid") {
      return {
        chatId: update.chatId,
        text: "Ссылка недействительна или истекла. Запросите новую в личном кабинете.",
      };
    }

    return {
      chatId: update.chatId,
      text: `Почти готово. Вернитесь в личный кабинет и подтвердите привязку Telegram.\n${lkUrl}`,
    };
  }

  return {
    chatId: update.chatId,
    text: "Команды: /status — статус подключения, /stop — отключить уведомления.",
  };
}

export async function maybeSendWebhookReply(
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport | null,
  reply: WebhookReply,
): Promise<void> {
  if (!reply || !transport || !config.deliveryEnabled) return;
  await transport({
    method: "sendMessage",
    token: config.botToken,
    body: { chat_id: reply.chatId.toString(), text: reply.text },
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
}
