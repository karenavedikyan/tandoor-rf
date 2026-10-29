import type { Pool, PoolClient } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport, TelegramDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markTelegramReplyDelivered } from "./webhook-inbox";

export async function deliverTelegramWebhookReply(
  db: Pool | PoolClient,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport,
  updateId: number,
  reply: WebhookReply,
): Promise<TelegramDeliveryResult | null> {
  if (!reply) return null;
  if (reply.answerCallbackQueryId) {
    await transport({
      method: "answerCallbackQuery",
      token: config.botToken,
      body: { callback_query_id: reply.answerCallbackQueryId },
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    });
  }
  const body: Record<string, unknown> = { chat_id: reply.chatId.toString(), text: reply.text };
  if (reply.replyMarkup) {
    body.reply_markup = reply.replyMarkup;
  }
  const result = await transport({
    method: "sendMessage",
    token: config.botToken,
    body,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  if (result.ok) {
    await markTelegramReplyDelivered(db, updateId);
  }
  return result;
}
