import type { MaxInlineButton } from "../tanbot-max/delivery-transport";

export type ReplyDeliveryProgress = {
  primary?: boolean;
  copyOnly?: boolean;
};

export type TelegramReplyExtra = {
  replyMarkup?: Record<string, unknown>;
  answerCallbackQueryId?: string;
  copyOnlyCode?: string;
  delivery?: ReplyDeliveryProgress;
};

export type MaxReplyExtra = {
  inlineButtons?: MaxInlineButton[][];
  copyOnlyCode?: string;
  delivery?: ReplyDeliveryProgress;
};

export function isHandoffReplyFullyDelivered(extra: {
  copyOnlyCode?: string;
  delivery?: ReplyDeliveryProgress;
}): boolean {
  if (!extra.delivery?.primary) return false;
  if (extra.copyOnlyCode && !extra.delivery.copyOnly) return false;
  return true;
}

export function telegramReplyExtraFromReply(reply: {
  replyMarkup?: TelegramReplyExtra["replyMarkup"];
  answerCallbackQueryId?: string;
  copyOnlyCode?: string;
}): TelegramReplyExtra | null {
  const hasCopy = typeof reply.copyOnlyCode === "string" && /^\d{6}$/.test(reply.copyOnlyCode);
  if (!reply.replyMarkup && !reply.answerCallbackQueryId && !hasCopy) return null;
  return {
    ...(reply.replyMarkup ? { replyMarkup: reply.replyMarkup } : {}),
    ...(reply.answerCallbackQueryId ? { answerCallbackQueryId: reply.answerCallbackQueryId } : {}),
    ...(hasCopy ? { copyOnlyCode: reply.copyOnlyCode, delivery: { primary: false, copyOnly: false } } : {}),
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
  if (typeof row.copyOnlyCode === "string" && /^\d{6}$/.test(row.copyOnlyCode)) {
    out.copyOnlyCode = row.copyOnlyCode;
  }
  const delivery = row.delivery;
  if (delivery && typeof delivery === "object" && !Array.isArray(delivery)) {
    const d = delivery as Record<string, unknown>;
    out.delivery = {
      ...(d.primary === true ? { primary: true } : {}),
      ...(d.copyOnly === true ? { copyOnly: true } : {}),
    };
  }
  return out;
}

export function maxReplyExtraFromReply(reply: {
  inlineButtons?: MaxInlineButton[][];
  copyOnlyCode?: string;
}): MaxReplyExtra | null {
  const hasCopy = typeof reply.copyOnlyCode === "string" && /^\d{6}$/.test(reply.copyOnlyCode);
  if (!reply.inlineButtons?.length && !hasCopy) return null;
  return {
    ...(reply.inlineButtons?.length ? { inlineButtons: reply.inlineButtons } : {}),
    ...(hasCopy ? { copyOnlyCode: reply.copyOnlyCode, delivery: { primary: false, copyOnly: false } } : {}),
  };
}

export function parseMaxReplyExtra(raw: unknown): MaxReplyExtra {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const out: MaxReplyExtra = {};
  const buttons = row.inlineButtons;
  if (Array.isArray(buttons)) {
    out.inlineButtons = buttons as MaxInlineButton[][];
  }
  if (typeof row.copyOnlyCode === "string" && /^\d{6}$/.test(row.copyOnlyCode)) {
    out.copyOnlyCode = row.copyOnlyCode;
  }
  const delivery = row.delivery;
  if (delivery && typeof delivery === "object" && !Array.isArray(delivery)) {
    const d = delivery as Record<string, unknown>;
    out.delivery = {
      ...(d.primary === true ? { primary: true } : {}),
      ...(d.copyOnly === true ? { copyOnly: true } : {}),
    };
  }
  return out;
}

export function mergeReplyDeliveryProgress(
  existing: ReplyDeliveryProgress | undefined,
  patch: Partial<ReplyDeliveryProgress>,
): ReplyDeliveryProgress {
  return {
    primary: !!(existing?.primary || patch.primary),
    copyOnly: !!(existing?.copyOnly || patch.copyOnly),
  };
}
