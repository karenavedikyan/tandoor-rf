import type { PoolClient } from "pg";
import type { NativeCreateContext, NativeCreateReply } from "./engine";
import {
  assertDraftBoundToCaller,
  assertDraftPersonRow,
  assertNativeCreateContext,
  lockNativeCreateMessenger,
} from "./access-guard";
import { loadNativeBotDraft, type NativeCreateActorKind } from "./draft-scope";
import type { ExternalRequestDraftRow } from "../../tan-tracker/external-request/draft-store";
import {
  buildCompactMenuInline,
  buildMainMenuInline,
  maxContactWithMenuInline,
  menuReplyKeyboard,
  telegramContactWithMenuKeyboard,
} from "./keyboards";

export const NATIVE_MAIN_MENU_ACTION_PROMPT = "Выберите действие.";
export const NATIVE_COMPACT_MENU_PROMPT = "Дополнительные действия.";

export function nativeMainMenuGreetingLines(ctx: NativeCreateContext): string[] {
  const lines = ["Тандор", "Посылки, документы и предметы с подтверждением получения.", ""];
  if (ctx.isLinkedStaff) {
    lines.push("Вы вошли как сотрудник.");
  } else if (ctx.personId) {
    lines.push("Номер телефона подтверждён.");
  } else {
    lines.push("Для оформления передачи подтвердите свой номер телефона.");
  }
  lines.push("", NATIVE_MAIN_MENU_ACTION_PROMPT);
  return lines;
}

export function nativeMainMenuText(ctx: NativeCreateContext, prefix?: string): string {
  const body = nativeMainMenuGreetingLines(ctx).join("\n");
  if (prefix?.trim()) return `${prefix.trim()}\n\n${body}`;
  return body;
}

/** Exact slash commands with optional @bot suffix; rejects /mystery-style prefixes. */
export function parseNativeBotSlashCommand(text: string): "start" | "menu" | "my" | "new" | null {
  const trimmed = text.trim();
  const m = trimmed.match(/^\/(start|menu|my|new)(@[A-Za-z0-9_]+)?(\s|$)/);
  if (!m) return null;
  const rest = trimmed.slice(m[0].length).trim();
  if (rest.length > 0) return null;
  return m[1]!.toLowerCase() as "start" | "menu" | "my" | "new";
}

const MENU_TEXT_TRIGGERS = new Set(["меню", "главное меню", "main menu"]);

export function isNativeMainMenuText(text: string): boolean {
  return MENU_TEXT_TRIGGERS.has(text.trim().toLowerCase());
}

export const NATIVE_CONTINUE_DRAFT_TEXT = "продолжить оформление";

export function isNativeContinueDraftText(text: string): boolean {
  return text.trim().toLowerCase() === NATIVE_CONTINUE_DRAFT_TEXT;
}

const CREATE_TRIGGERS = new Set([
  "оформить передачу",
  "создать передачу",
  "/send",
  "/create",
  "/create@",
  "отправить предмет",
]);

export function isNativeCreateMenuText(text: string): boolean {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (CREATE_TRIGGERS.has(lower)) return true;
  if (parseNativeBotSlashCommand(t) === "new") return true;
  if (lower === "/send" || /^\/send@[A-Za-z0-9_]+$/i.test(t)) return true;
  if (lower === "/create" || /^\/create@[A-Za-z0-9_]+$/i.test(t)) return true;
  return false;
}

export async function peekResumableNativeDraft(
  client: PoolClient,
  ctx: NativeCreateContext,
): Promise<ExternalRequestDraftRow | null> {
  if (!ctx.privateDialogOk) return null;
  try {
    await assertNativeCreateContext(client, ctx);
  } catch {
    return null;
  }
  const actor: NativeCreateActorKind = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor);
  if (!draft) return null;
  try {
    const payload = draft.payload as import("./draft-scope").NativeCreateDraftPayload;
    assertDraftBoundToCaller(payload, ctx);
    if (actor === "external") assertDraftPersonRow(draft, ctx);
  } catch {
    return null;
  }
  return draft;
}

async function resumeDraftHint(
  client: PoolClient,
  ctx: NativeCreateContext,
): Promise<{ draftId: string; revision: number } | undefined> {
  const resumeDraft = await peekResumableNativeDraft(client, ctx);
  if (resumeDraft == null) return undefined;
  return {
    draftId: resumeDraft.id,
    revision: (resumeDraft.payload as { revision?: number }).revision ?? 1,
  };
}

/** Home screen: primary actions and optional draft resume. */
export async function buildNativeMainMenuReply(
  client: PoolClient,
  ctx: NativeCreateContext,
  options: { prefix?: string; lock?: boolean } = {},
): Promise<NativeCreateReply> {
  if (options.lock !== false) {
    await lockNativeCreateMessenger(client, ctx);
  }
  const resume = await resumeDraftHint(client, ctx);
  const text = nativeMainMenuText(ctx, options.prefix);
  const keyboard = menuReplyKeyboard({ showContinue: !!resume });
  if (ctx.channel === "telegram") {
    return {
      text,
      replyMarkup: keyboard,
      telegramInlineKeyboard: undefined,
      maxInlineButtons: undefined,
    };
  }
  const inline = buildMainMenuInline("max", resume);
  return {
    text,
    replyMarkup: keyboard,
    maxInlineButtons: inline.maxInlineButtons,
    telegramInlineKeyboard: undefined,
  };
}

/** Compact secondary menu; preserves draft. */
export async function buildNativeCompactMenuReply(
  client: PoolClient,
  ctx: NativeCreateContext,
  options: { prefix?: string; lock?: boolean } = {},
): Promise<NativeCreateReply> {
  if (options.lock !== false) {
    await lockNativeCreateMessenger(client, ctx);
  }
  const resume = await resumeDraftHint(client, ctx);
  const prefix = options.prefix?.trim();
  const text = prefix
    ? `${prefix}\n\n${NATIVE_COMPACT_MENU_PROMPT}`
    : `${nativeMainMenuGreetingLines(ctx).slice(0, 3).join("\n")}\n\n${NATIVE_COMPACT_MENU_PROMPT}`;
  const keyboard = menuReplyKeyboard({ showContinue: !!resume });
  const inline = buildCompactMenuInline(ctx.channel, resume);
  if (ctx.channel === "telegram") {
    return {
      text,
      replyMarkup: keyboard,
      telegramInlineKeyboard: inline.telegramInlineKeyboard,
      maxInlineButtons: undefined,
    };
  }
  return {
    text,
    replyMarkup: keyboard,
    maxInlineButtons: inline.maxInlineButtons,
    telegramInlineKeyboard: undefined,
  };
}

/** Verified own-contact gate for protected menu actions (no draft/session writes). */
export function nativeVerifiedContactRequiredReply(
  ctx: NativeCreateContext,
  message: string,
): NativeCreateReply {
  if (ctx.channel === "telegram") {
    return {
      text: message,
      requestContact: true,
      replyMarkup: telegramContactWithMenuKeyboard(),
      telegramInlineKeyboard: undefined,
      maxInlineButtons: undefined,
    };
  }
  const inline = maxContactWithMenuInline();
  return {
    text: message,
    requestContact: true,
    maxInlineButtons: inline.maxInlineButtons,
    replyMarkup: menuReplyKeyboard(),
    telegramInlineKeyboard: undefined,
  };
}

/** Post-create reply: transfer-specific actions are attached by the caller, never a full menu. */
export async function nativeCompletionMenuReply(
  client: PoolClient,
  ctx: NativeCreateContext,
  resultText: string,
): Promise<NativeCreateReply> {
  return {
    text: resultText.replace(
      "в «Моих передачах» доступно «Обновить приглашение»",
      "нажмите «Получить код у получателя»",
    ),
    replyMarkup: ctx.channel === "telegram" ? { remove_keyboard: true } : undefined,
    telegramInlineKeyboard: undefined,
    maxInlineButtons: undefined,
  };
}
