import type { Pool, PoolClient } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport, TelegramDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markTelegramReplyDelivered } from "./webhook-inbox";
import { applyTelegramWebhookReplyLinkPreviewSafety } from "./send-message-safety";
import {
  loadTelegramReplyRow,
  markTelegramExtraProgress,
  nextTelegramDeliveryStep,
  persistTelegramReplyExtra,
  telegramExtraFromStored,
} from "../tanbot/webhook-reply-pair-delivery";
import { isHandoffReplyFullyDelivered } from "../tanbot/webhook-reply-extra";

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
  applyTelegramWebhookReplyLinkPreviewSafety(body, input.text, Boolean(input.replyMarkup));
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

  const stored = await loadTelegramReplyRow(db, updateId);
  let extra = telegramExtraFromStored(stored?.reply_extra);
  const primaryText = stored?.reply_text ?? reply.text;

  if (reply.answerCallbackQueryId && nextTelegramDeliveryStep(extra) === "primary") {
    await transport({
      method: "answerCallbackQuery",
      token: config.botToken,
      body: { callback_query_id: reply.answerCallbackQueryId },
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    });
  }

  let lastResult: TelegramDeliveryResult | null = null;

  for (let guard = 0; guard < 3; guard++) {
    const step = nextTelegramDeliveryStep(extra);
    if (step === "done") break;

    if (step === "primary") {
      const body = buildTelegramSendMessagePayload({
        chatId: reply.chatId,
        text: primaryText,
        replyMarkup: extra.replyMarkup ?? reply.replyMarkup,
      });
      lastResult = await transport({
        method: "sendMessage",
        token: config.botToken,
        body,
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      });
      if (!lastResult.ok) return lastResult;
      extra = markTelegramExtraProgress(extra, "primary");
      await persistTelegramReplyExtra(db, updateId, extra);
      continue;
    }

    if (step === "copyOnly" && extra.copyOnlyCode) {
      const body = buildTelegramSendMessagePayload({
        chatId: reply.chatId,
        text: extra.copyOnlyCode,
      });
      lastResult = await transport({
        method: "sendMessage",
        token: config.botToken,
        body,
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      });
      if (!lastResult.ok) return lastResult;
      extra = markTelegramExtraProgress(extra, "copyOnly");
      await persistTelegramReplyExtra(db, updateId, extra);
    }
  }

  if (isHandoffReplyFullyDelivered(extra)) {
    await markTelegramReplyDelivered(db, updateId);
  }
  return lastResult;
}
