import type { MaxInlineButton } from "../../tanbot-max/delivery-transport";
import { buildNativeCreateCallback } from "./callback-codec";

export type NativeCreateUi = {
  telegramInlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
  telegramReplyKeyboard?: Record<string, unknown>;
  maxInlineButtons?: MaxInlineButton[][];
};

export function menuReplyKeyboard(): Record<string, unknown> {
  return {
    keyboard: [
      [{ text: "Мои передачи" }, { text: "Создать передачу" }],
      [{ text: "Отправить предмет" }],
    ],
    resize_keyboard: true,
  };
}

type BtnDef = { label: string; action: Parameters<typeof buildNativeCreateCallback>[0]; arg?: string };

function tgRow(draftId: string, revision: number, buttons: BtnDef[]) {
  return buttons.map((b) => ({
    text: b.label,
    callback_data: buildNativeCreateCallback(b.action, draftId, revision, b.arg),
  }));
}

function maxRow(draftId: string, revision: number, buttons: BtnDef[]): MaxInlineButton[] {
  return buttons.map((b) => ({
    type: "callback" as const,
    text: b.label,
    payload: buildNativeCreateCallback(b.action, draftId, revision, b.arg),
  }));
}

const NAV: BtnDef[] = [
  { label: "◀ Назад", action: "back" },
  { label: "Отмена", action: "cancel" },
  { label: "Меню", action: "menu" },
];

export function buildStepUi(
  channel: "telegram" | "max",
  draftId: string,
  revision: number,
  kind: "nav" | "photo" | "summary" | "due" | "recipient",
  extra?: { recipientButtons?: Array<{ label: string; arg: string }>; pageNav?: { hasPrev: boolean; hasNext: boolean } },
): NativeCreateUi {
  if (kind === "photo") {
    const primary: BtnDef[] = [
      { label: "Далее", action: "photo_next" },
      { label: "Пропустить", action: "photo_skip" },
    ];
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, NAV)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, NAV)] };
  }
  if (kind === "due") {
    const primary: BtnDef[] = [
      { label: "Сегодня", action: "due", arg: "t" },
      { label: "Завтра", action: "due", arg: "m" },
      { label: "Без срока", action: "due", arg: "n" },
    ];
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, NAV)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, NAV)] };
  }
  if (kind === "summary") {
    const primary: BtnDef[] = [
      { label: "Создать", action: "confirm" },
      { label: "Изменить", action: "edit" },
    ];
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, NAV)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, NAV)] };
  }
  if (kind === "recipient" && extra?.recipientButtons?.length) {
    const pickBtns: BtnDef[] = extra.recipientButtons.map((b) => ({
      label: b.label,
      action: "recipient" as const,
      arg: b.arg,
    }));
    const tgRows: Array<Array<{ text: string; callback_data: string }>> = [];
    const maxRows: MaxInlineButton[][] = [];
    for (let i = 0; i < pickBtns.length; i += 2) {
      const slice = pickBtns.slice(i, i + 2);
      if (channel === "telegram") tgRows.push(tgRow(draftId, revision, slice));
      else maxRows.push(maxRow(draftId, revision, slice));
    }
    const pageBtns: BtnDef[] = [];
    if (extra.pageNav?.hasPrev) pageBtns.push({ label: "◀ Стр.", action: "recipient_page", arg: "p" });
    if (extra.pageNav?.hasNext) pageBtns.push({ label: "Стр. ▶", action: "recipient_page", arg: "n" });
    if (pageBtns.length) {
      if (channel === "telegram") tgRows.push(tgRow(draftId, revision, pageBtns));
      else maxRows.push(maxRow(draftId, revision, pageBtns));
    }
    if (channel === "telegram") {
      tgRows.push(tgRow(draftId, revision, NAV));
      return { telegramInlineKeyboard: tgRows };
    }
    maxRows.push(maxRow(draftId, revision, NAV));
    return { maxInlineButtons: maxRows };
  }
  return channel === "telegram"
    ? { telegramInlineKeyboard: [tgRow(draftId, revision, NAV)] }
    : { maxInlineButtons: [maxRow(draftId, revision, NAV)] };
}
