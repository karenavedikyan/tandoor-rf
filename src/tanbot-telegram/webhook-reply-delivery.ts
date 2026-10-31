import type { Pool, PoolClient } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport, TelegramDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markTelegramReplyDelivered, updateTelegramReplyExtra } from "./webhook-inbox";
import { applyTelegramWebhookReplyLinkPreviewSafety } from "./send-message-safety";
import { parseTelegramReplyExtra } from "../tanbot/webhook-reply-extra";
import { deliverTelegramNativeMediaFromExtra } from "../tanbot/native-create/media-delivery";
import { mergeReplyExtraRecord, NATIVE_MEDIA_PROGRESS_KEY } from "../tanbot/native-create/reply-media";

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

function mediaDeliveryComplete(extra: Record<string, unknown>): boolean {
  const parsed = parseTelegramReplyExtra(extra);
  const queueLen = parsed.nativeMediaQueue?.length ?? 0;
  const prog = parsed.nativeMediaProgress ?? {};
  if (!prog.textDelivered) return false;
  if (queueLen === 0) return true;
  return (prog.mediaDeliveredCount ?? 0) >= queueLen;
}

export async function deliverTelegramWebhookReply(
  db: Pool | PoolClient,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport,
  updateId: number,
  reply: WebhookReply,
  options: { storedExtra?: unknown } = {},
): Promise<TelegramDeliveryResult | null> {
  if (!reply) return null;
  let extraRecord: Record<string, unknown> =
    options.storedExtra && typeof options.storedExtra === "object" && !Array.isArray(options.storedExtra)
      ? { ...(options.storedExtra as Record<string, unknown>) }
      : reply.replyExtra
        ? { ...reply.replyExtra }
        : {};
  const parsed = parseTelegramReplyExtra(extraRecord);

  if (reply.answerCallbackQueryId) {
    await transport({
      method: "answerCallbackQuery",
      token: config.botToken,
      body: { callback_query_id: reply.answerCallbackQueryId },
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    });
  }

  const progress = parsed.nativeMediaProgress ?? {};
  if (!progress.textDelivered) {
    const body = buildTelegramSendMessagePayload({
      chatId: reply.chatId,
      text: reply.text,
      replyMarkup: parsed.replyMarkup ?? reply.replyMarkup,
    });
    const result = await transport({
      method: "sendMessage",
      token: config.botToken,
      body,
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    });
    if (!result.ok) return result;
    extraRecord = mergeReplyExtraRecord(extraRecord, {
      [NATIVE_MEDIA_PROGRESS_KEY]: {
        textDelivered: true,
        mediaDeliveredCount: progress.mediaDeliveredCount ?? 0,
      },
    });
    await updateTelegramReplyExtra(db, updateId, extraRecord);
  }

  const scope = parsed.nativeMediaScope;
  if (scope && (parsed.nativeMediaQueue?.length ?? 0) > 0) {
    const media = await deliverTelegramNativeMediaFromExtra(db, config, transport, {
      chatId: reply.chatId,
      replyExtra: extraRecord,
      messengerChatId: scope.messengerChatId,
      actor: scope.actor,
    });
    extraRecord = media.extra;
    await updateTelegramReplyExtra(db, updateId, extraRecord);
    if (!media.ok) {
      return { ok: false, code: "MEDIA_DELIVERY", message: "Native media delivery failed.", retryable: true };
    }
  }

  if (mediaDeliveryComplete(extraRecord)) {
    await markTelegramReplyDelivered(db, updateId);
  }
  return { ok: true, result: {} };
}
