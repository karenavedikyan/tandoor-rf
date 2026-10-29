import type { Pool, PoolClient } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport, TelegramDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markTelegramReplyDelivered } from "./webhook-inbox";

export function buildTelegramSendMessagePayload(input: {
  chatId: bigint;
  text: string;
  replyMarkup?: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId.toString(),
    text: input.text,
  };
  if (input.replyMarkup) {
    body.reply_markup = input.replyMarkup;
  }
  return body;
}

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
  const body = buildTelegramSendMessagePayload({
    chatId: reply.chatId,
    text: reply.text,
    replyMarkup: reply.replyMarkup,
  });
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
