import type { MaxInlineButton } from "../tanbot-max/delivery-transport";
import {
  NATIVE_MEDIA_PROGRESS_KEY,
  NATIVE_MEDIA_QUEUE_KEY,
  NATIVE_MEDIA_SCOPE_KEY,
  readNativeMediaProgress,
  readNativeMediaQueue,
  type NativeMediaDeliveryProgress,
} from "./native-create/reply-media";
import type { NativeMediaScope } from "./native-create/webhook-reply-bridge";

export type ReplyDeliveryProgress = {
  primary?: boolean;
  copyOnly?: boolean;
  invitation?: boolean;
};

export type TelegramReplyExtra = {
  forwardInvitationText?: string;
  replyMarkup?: Record<string, unknown>;
  answerCallbackQueryId?: string;
  copyOnlyCode?: string;
  delivery?: ReplyDeliveryProgress;
  nativeMediaQueue?: ReturnType<typeof readNativeMediaQueue>;
  nativeMediaProgress?: NativeMediaDeliveryProgress;
  nativeMediaScope?: NativeMediaScope;
};

export type MaxReplyExtra = {
  forwardInvitationText?: string;
  inlineButtons?: MaxInlineButton[][];
  copyOnlyCode?: string;
  delivery?: ReplyDeliveryProgress;
  nativeMediaQueue?: ReturnType<typeof readNativeMediaQueue>;
  nativeMediaProgress?: NativeMediaDeliveryProgress;
  nativeMediaScope?: NativeMediaScope;
};

function readPassthrough(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

function nativeMediaPending(extra: {
  nativeMediaQueue?: ReturnType<typeof readNativeMediaQueue>;
  nativeMediaProgress?: NativeMediaDeliveryProgress;
}): boolean {
  const queueLen = extra.nativeMediaQueue?.length ?? 0;
  if (queueLen === 0) return false;
  const prog = extra.nativeMediaProgress ?? {};
  if (prog.disposition === "canceled") return false;
  return (prog.mediaDeliveredCount ?? 0) < queueLen;
}

export function isHandoffReplyFullyDelivered(extra: TelegramReplyExtra | MaxReplyExtra): boolean {
  if (!extra.delivery?.primary) return false;
  if (extra.copyOnlyCode && !extra.delivery.copyOnly) return false;
  if (extra.forwardInvitationText && !extra.delivery.invitation) return false;
  if (nativeMediaPending(extra)) return false;
  return true;
}

export function telegramReplyExtraFromReply(reply: {
  replyMarkup?: TelegramReplyExtra["replyMarkup"];
  answerCallbackQueryId?: string;
  copyOnlyCode?: string;
  replyExtra?: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (reply.replyExtra) return reply.replyExtra;
  const hasCopy = typeof reply.copyOnlyCode === "string" && /^\d{6}$/.test(reply.copyOnlyCode);
  if (!reply.replyMarkup && !reply.answerCallbackQueryId && !hasCopy) return null;
  return {
    ...(reply.replyMarkup ? { replyMarkup: reply.replyMarkup } : {}),
    ...(reply.answerCallbackQueryId ? { answerCallbackQueryId: reply.answerCallbackQueryId } : {}),
    ...(hasCopy ? { copyOnlyCode: reply.copyOnlyCode, delivery: { primary: false, copyOnly: false } } : {}),
  };
}

function parseNativeMediaScope(row: Record<string, unknown>): NativeMediaScope | undefined {
  const scope = row[NATIVE_MEDIA_SCOPE_KEY];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return undefined;
  const s = scope as Record<string, unknown>;
  const messengerChatId = typeof s.messengerChatId === "string" ? s.messengerChatId : "";
  const messengerUserId = typeof s.messengerUserId === "string" ? s.messengerUserId : messengerChatId;
  const actor = s.actor === "staff" || s.actor === "external" ? s.actor : null;
  if (!messengerChatId || !actor) return undefined;
  const channel = s.channel === "max" || s.channel === "telegram" ? s.channel : undefined;
  return {
    messengerChatId,
    messengerUserId,
    actor,
    ...(channel ? { channel } : {}),
  };
}

export function parseTelegramReplyExtra(raw: unknown): TelegramReplyExtra & Record<string, unknown> {
  const row = readPassthrough(raw);
  const out: TelegramReplyExtra & Record<string, unknown> = { ...row };
  delete out.forwardInvitationText;
  if (typeof row.forwardInvitationText === "string" && row.forwardInvitationText.trim()
      && row.forwardInvitationText.length <= 4000) {
    out.forwardInvitationText = row.forwardInvitationText;
  }
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
      ...(d.invitation === true ? { invitation: true } : {}),
    };
  }
  out.nativeMediaQueue = readNativeMediaQueue(row);
  out.nativeMediaProgress = readNativeMediaProgress(row);
  const scope = parseNativeMediaScope(row);
  if (scope) out.nativeMediaScope = scope;
  return out;
}

export function maxReplyExtraFromReply(reply: {
  inlineButtons?: MaxInlineButton[][];
  copyOnlyCode?: string;
  replyExtra?: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (reply.replyExtra) return reply.replyExtra;
  const hasCopy = typeof reply.copyOnlyCode === "string" && /^\d{6}$/.test(reply.copyOnlyCode);
  if (!reply.inlineButtons?.length && !hasCopy) return null;
  return {
    ...(reply.inlineButtons?.length ? { inlineButtons: reply.inlineButtons } : {}),
    ...(hasCopy ? { copyOnlyCode: reply.copyOnlyCode, delivery: { primary: false, copyOnly: false } } : {}),
  };
}

export function parseMaxReplyExtra(raw: unknown): MaxReplyExtra & Record<string, unknown> {
  const row = readPassthrough(raw);
  const out: MaxReplyExtra & Record<string, unknown> = { ...row };
  delete out.forwardInvitationText;
  if (typeof row.forwardInvitationText === "string" && row.forwardInvitationText.trim()
      && row.forwardInvitationText.length <= 4000) {
    out.forwardInvitationText = row.forwardInvitationText;
  }
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
      ...(d.invitation === true ? { invitation: true } : {}),
    };
  }
  out.nativeMediaQueue = readNativeMediaQueue(row);
  out.nativeMediaProgress = readNativeMediaProgress(row);
  const scope = parseNativeMediaScope(row);
  if (scope) out.nativeMediaScope = scope;
  return out;
}

export function mergeReplyDeliveryProgress(
  existing: ReplyDeliveryProgress | undefined,
  patch: Partial<ReplyDeliveryProgress>,
): ReplyDeliveryProgress {
  return {
    primary: !!(existing?.primary || patch.primary),
    copyOnly: !!(existing?.copyOnly || patch.copyOnly),
    ...(existing?.invitation || patch.invitation ? { invitation: true } : {}),
  };
}

export { NATIVE_MEDIA_QUEUE_KEY, NATIVE_MEDIA_PROGRESS_KEY, NATIVE_MEDIA_SCOPE_KEY };
