import type { MaxInlineButton } from "../tanbot-max/delivery-transport";

export type TelegramReplyExtra = {
  replyMarkup?: Record<string, unknown>;
  answerCallbackQueryId?: string;
};

export type MaxReplyExtra = {
  inlineButtons?: MaxInlineButton[][];
};

export function telegramReplyExtraFromReply(reply: {
  replyMarkup?: TelegramReplyExtra["replyMarkup"];
  answerCallbackQueryId?: string;
}): TelegramReplyExtra | null {
  if (!reply.replyMarkup && !reply.answerCallbackQueryId) return null;
  return {
    ...(reply.replyMarkup ? { replyMarkup: reply.replyMarkup } : {}),
    ...(reply.answerCallbackQueryId ? { answerCallbackQueryId: reply.answerCallbackQueryId } : {}),
  };
}

export function parseTelegramReplyExtra(raw: unknown): TelegramReplyExtra {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const out: TelegramReplyExtra = {};
  const markup = row.replyMarkup;
  if (markup && typeof markup === "object" && !Array.isArray(markup)) {
    out.replyMarkup = markup as TelegramReplyExtra["replyMarkup"];
  }
  if (typeof row.answerCallbackQueryId === "string" && row.answerCallbackQueryId.trim()) {
    out.answerCallbackQueryId = row.answerCallbackQueryId;
  }
  return out;
}

export function maxReplyExtraFromReply(reply: { inlineButtons?: MaxInlineButton[][] }): MaxReplyExtra | null {
  if (!reply.inlineButtons?.length) return null;
  return { inlineButtons: reply.inlineButtons };
}

export function parseMaxReplyExtra(raw: unknown): MaxReplyExtra {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const buttons = row.inlineButtons;
  if (Array.isArray(buttons)) {
    return { inlineButtons: buttons as MaxInlineButton[][] };
  }
  return {};
}
