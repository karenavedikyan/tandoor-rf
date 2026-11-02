import type { NativeCreateReply } from "./engine";

/** Telegram rejects empty text; keep auxiliary keyboard messages visually minimal. */
export const TELEGRAM_KEYBOARD_AUX_TEXT = "\u200b";

export type PackedTelegramReplyMarkup = {
  replyMarkup?: Record<string, unknown>;
  replyKeyboardClear?: boolean;
  replyKeyboardRestore?: Record<string, unknown>;
};

function isReplyKeyboardMarkup(markup: Record<string, unknown>): boolean {
  return Array.isArray(markup.keyboard);
}

export function packTelegramNativeReplyMarkup(reply: NativeCreateReply): PackedTelegramReplyMarkup {
  if (reply.telegramInlineKeyboard == null) {
    return { replyMarkup: reply.replyMarkup };
  }
  const inline = { inline_keyboard: reply.telegramInlineKeyboard };
  const replyKb = reply.replyMarkup;
  if (replyKb?.remove_keyboard === true) {
    return { replyMarkup: inline, replyKeyboardClear: true };
  }
  if (replyKb && isReplyKeyboardMarkup(replyKb)) {
    // A contextual inline screen must not resurrect the home keyboard underneath it.
    // Home/contact replies without inline markup are handled by the first branch.
    return {
      replyMarkup: inline,
      replyKeyboardClear: true,
    };
  }
  return { replyMarkup: inline };
}
