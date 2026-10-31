import type { NativeCreateActorKind } from "./draft-scope";
import {
  NATIVE_MEDIA_PROGRESS_KEY,
  NATIVE_MEDIA_QUEUE_KEY,
  NATIVE_MEDIA_SCOPE_KEY,
  type NativeReplyMediaItem,
  mergeReplyExtraRecord,
} from "./reply-media";
import type { TelegramReplyExtra } from "../webhook-reply-extra";

export type NativeMediaScope = {
  messengerChatId: string;
  messengerUserId: string;
  actor: NativeCreateActorKind;
  channel?: "telegram" | "max";
};

export function buildNativeWebhookReplyExtra(input: {
  replyMarkup?: TelegramReplyExtra["replyMarkup"];
  answerCallbackQueryId?: string;
  inlineButtons?: unknown;
  nativeMediaQueue?: NativeReplyMediaItem[];
  scope: NativeMediaScope;
  merge?: Record<string, unknown>;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...(input.merge ?? {}) };
  if (input.replyMarkup) patch.replyMarkup = input.replyMarkup;
  if (input.answerCallbackQueryId) patch.answerCallbackQueryId = input.answerCallbackQueryId;
  if (input.inlineButtons) patch.inlineButtons = input.inlineButtons;
  if (input.nativeMediaQueue?.length) {
    patch[NATIVE_MEDIA_QUEUE_KEY] = input.nativeMediaQueue;
    patch[NATIVE_MEDIA_PROGRESS_KEY] = { mediaDeliveredCount: 0 };
    patch[NATIVE_MEDIA_SCOPE_KEY] = input.scope;
  }
  return patch;
}

export function mergeNativeIntoStoredExtra(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return mergeReplyExtraRecord(existing, patch);
}
