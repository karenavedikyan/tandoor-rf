import type { PoolClient } from "pg";
import type { NativeCreateContext, NativeCreateReply } from "./engine";
import {
  assertDraftBoundToCaller,
  assertDraftPersonRow,
  lockNativeCreateMessenger,
} from "./access-guard";
import { loadNativeBotDraft, type NativeCreateActorKind } from "./draft-scope";
import type { ExternalRequestDraftRow } from "../../tan-tracker/external-request/draft-store";
import { buildMainMenuInline, menuReplyKeyboard } from "./keyboards";

export const NATIVE_MAIN_MENU_ACTION_PROMPT = "Выберите действие.";

export function nativeMainMenuGreetingLines(ctx: NativeCreateContext): string[] {
  const lines = ["Тандор. Бот для оформления передач: документы, посылки и предметы."];
  if (ctx.isLinkedStaff) {
    lines.push("Вы вошли как сотрудник.");
  } else if (ctx.personId) {
    lines.push("Номер подтверждён — можно оформить передачу или открыть список.");
  } else {
    lines.push("Для оформления передачи подтвердите свой номер телефона.");
  }
  lines.push(NATIVE_MAIN_MENU_ACTION_PROMPT);
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

export async function peekResumableNativeDraft(
  client: PoolClient,
  ctx: NativeCreateContext,
): Promise<ExternalRequestDraftRow | null> {
  if (!ctx.privateDialogOk) return null;
  if (ctx.isLinkedStaff) {
    if (!ctx.staffUserId) return null;
    const row = await client.query<{ status: string }>(`SELECT status FROM users WHERE id = $1::uuid`, [
      ctx.staffUserId,
    ]);
    if (row.rows[0]?.status !== "active") return null;
  } else if (!ctx.personId) {
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

export async function buildNativeMainMenuReply(
  client: PoolClient,
  ctx: NativeCreateContext,
  options: { prefix?: string; lock?: boolean } = {},
): Promise<NativeCreateReply> {
  if (options.lock !== false) {
    await lockNativeCreateMessenger(client, ctx);
  }
  const resumeDraft = await peekResumableNativeDraft(client, ctx);
  const resume =
    resumeDraft != null
      ? { draftId: resumeDraft.id, revision: (resumeDraft.payload as { revision?: number }).revision ?? 1 }
      : undefined;
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
