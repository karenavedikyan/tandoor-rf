import type { MaxInlineButton } from "../tanbot-max/delivery-transport";
import {
  NATIVE_MEDIA_PROGRESS_KEY,
  NATIVE_MEDIA_QUEUE_KEY,
  NATIVE_MEDIA_SCOPE_KEY,
  readNativeMediaProgress,
  readNativeMediaQueue,
} from "./native-create/reply-media";
import type { NativeMediaScope } from "./native-create/webhook-reply-bridge";

export type TelegramReplyExtra = {
  replyMarkup?: Record<string, unknown>;
  answerCallbackQueryId?: string;
  nativeMediaQueue?: ReturnType<typeof readNativeMediaQueue>;
  nativeMediaProgress?: ReturnType<typeof readNativeMediaProgress>;
  nativeMediaScope?: NativeMediaScope;
};

export type MaxReplyExtra = {
  inlineButtons?: MaxInlineButton[][];
  nativeMediaQueue?: ReturnType<typeof readNativeMediaQueue>;
  nativeMediaProgress?: ReturnType<typeof readNativeMediaProgress>;
  nativeMediaScope?: NativeMediaScope;
};

function readPassthrough(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

export function telegramReplyExtraFromReply(reply: {
  replyMarkup?: TelegramReplyExtra["replyMarkup"];
  answerCallbackQueryId?: string;
  replyExtra?: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (reply.replyExtra) return reply.replyExtra;
  if (!reply.replyMarkup && !reply.answerCallbackQueryId) return null;
  return {
    ...(reply.replyMarkup ? { replyMarkup: reply.replyMarkup } : {}),
    ...(reply.answerCallbackQueryId ? { answerCallbackQueryId: reply.answerCallbackQueryId } : {}),
  };
}

export function parseTelegramReplyExtra(raw: unknown): TelegramReplyExtra & Record<string, unknown> {
  const row = readPassthrough(raw);
  const out: TelegramReplyExtra & Record<string, unknown> = { ...row };
  const markup = row.replyMarkup;
  if (markup && typeof markup === "object" && !Array.isArray(markup)) {
    out.replyMarkup = markup as TelegramReplyExtra["replyMarkup"];
  }
  if (typeof row.answerCallbackQueryId === "string" && row.answerCallbackQueryId.trim()) {
    out.answerCallbackQueryId = row.answerCallbackQueryId;
  }
  out.nativeMediaQueue = readNativeMediaQueue(row);
  out.nativeMediaProgress = readNativeMediaProgress(row);
  const scope = row[NATIVE_MEDIA_SCOPE_KEY];
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const s = scope as Record<string, unknown>;
    if (typeof s.messengerChatId === "string" && (s.actor === "staff" || s.actor === "external")) {
      out.nativeMediaScope = { messengerChatId: s.messengerChatId, actor: s.actor };
    }
  }
  return out;
}

export function maxReplyExtraFromReply(reply: {
  inlineButtons?: MaxInlineButton[][];
  replyExtra?: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (reply.replyExtra) return reply.replyExtra;
  if (!reply.inlineButtons?.length) return null;
  return { inlineButtons: reply.inlineButtons };
}

export function parseMaxReplyExtra(raw: unknown): MaxReplyExtra & Record<string, unknown> {
  const row = readPassthrough(raw);
  const out: MaxReplyExtra & Record<string, unknown> = { ...row };
  const buttons = row.inlineButtons;
  if (Array.isArray(buttons)) {
    out.inlineButtons = buttons as MaxInlineButton[][];
  }
  out.nativeMediaQueue = readNativeMediaQueue(row);
  out.nativeMediaProgress = readNativeMediaProgress(row);
  const scope = row[NATIVE_MEDIA_SCOPE_KEY];
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const s = scope as Record<string, unknown>;
    if (typeof s.messengerChatId === "string" && (s.actor === "staff" || s.actor === "external")) {
      out.nativeMediaScope = { messengerChatId: s.messengerChatId, actor: s.actor };
    }
  }
  return out;
}

export { NATIVE_MEDIA_QUEUE_KEY, NATIVE_MEDIA_PROGRESS_KEY, NATIVE_MEDIA_SCOPE_KEY };
