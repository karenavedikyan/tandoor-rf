import type { Pool } from "pg";
import type { TanbotTelegramStage2Config } from "./stage2-config";
import type { TelegramDeliveryTransport, TelegramDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markTelegramReplyDelivered, updateTelegramReplyExtra } from "./webhook-inbox";
import { applyTelegramWebhookReplyLinkPreviewSafety } from "./send-message-safety";
import {
  loadTelegramReplyRowLocked,
  mergeTelegramReplyDeliveryProgress,
  nextTelegramDeliveryStep,
  telegramExtraFromStored,
  withTelegramReplyDeliveryLock,
} from "../tanbot/webhook-reply-pair-delivery";
import { isHandoffReplyFullyDelivered } from "../tanbot/webhook-reply-extra";
import { deliverTelegramNativeMediaFromExtra } from "../tanbot/native-create/media-delivery";

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

async function deliverTelegramWebhookReplyUnderLock(
  client: import("pg").PoolClient,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport,
  updateId: number,
  reply: WebhookReply,
): Promise<TelegramDeliveryResult | null> {
  if (!reply) return null;

  let row = await loadTelegramReplyRowLocked(client, updateId);
  if (!row || row.reply_delivered_at) return null;

  let extra = telegramExtraFromStored(row.reply_extra);
  const primaryText = row.reply_text ?? reply.text;

  let lastResult: TelegramDeliveryResult | null = null;
  let answeredCallback = false;

  for (let guard = 0; guard < 12; guard++) {
    row = await loadTelegramReplyRowLocked(client, updateId);
    if (!row || row.reply_delivered_at) break;
    extra = telegramExtraFromStored(row.reply_extra);
    const step = nextTelegramDeliveryStep(extra);
    if (step === "done") break;

    if (step === "primary") {
      if (reply.answerCallbackQueryId && !answeredCallback) {
        await transport({
          method: "answerCallbackQuery",
          token: config.botToken,
          body: { callback_query_id: reply.answerCallbackQueryId },
          timeoutMs: config.requestTimeoutMs,
          maxResponseBytes: config.maxResponseBytes,
        });
        answeredCallback = true;
      }
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
      await mergeTelegramReplyDeliveryProgress(client, updateId, "primary");
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
      await mergeTelegramReplyDeliveryProgress(client, updateId, "copyOnly");
      continue;
    }

    if (step === "invitation" && extra.forwardInvitationText) {
      lastResult = await transport({
        method: "sendMessage",
        token: config.botToken,
        body: buildTelegramSendMessagePayload({
          chatId: reply.chatId,
          text: extra.forwardInvitationText,
        }),
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      });
      if (!lastResult.ok) return lastResult;
      await mergeTelegramReplyDeliveryProgress(client, updateId, "invitation");
      continue;
    }

    if (step === "nativeMedia") {
      const scope = extra.nativeMediaScope;
      if (!scope) break;
      const media = await deliverTelegramNativeMediaFromExtra(client, config, transport, {
        chatId: reply.chatId,
        replyExtra: row.reply_extra,
        scope,
      });
      await updateTelegramReplyExtra(client, updateId, media.extra);
      if (!media.ok) {
        return {
          ok: false,
          code: "MEDIA_DELIVERY",
          message: "Native media delivery failed.",
          retryable: media.retryable !== false,
        };
      }
      continue;
    }
  }

  row = await loadTelegramReplyRowLocked(client, updateId);
  extra = telegramExtraFromStored(row?.reply_extra);
  if (row && !row.reply_delivered_at && isHandoffReplyFullyDelivered(extra)) {
    await markTelegramReplyDelivered(client, updateId);
  }
  return lastResult ?? { ok: true, result: {} };
}

export async function deliverTelegramWebhookReply(
  pool: Pool,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport,
  updateId: number,
  reply: WebhookReply,
): Promise<TelegramDeliveryResult | null> {
  return withTelegramReplyDeliveryLock(pool, updateId, (client) =>
    deliverTelegramWebhookReplyUnderLock(client, config, transport, updateId, reply),
  );
}
