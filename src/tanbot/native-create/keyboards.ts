import type { MaxInlineButton } from "../../tanbot-max/delivery-transport";
import { buildNativeCreateCallback } from "./callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "./menu-sentinel";

export type NativeCreateUi = {
  telegramInlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
  telegramReplyKeyboard?: Record<string, unknown>;
  maxInlineButtons?: MaxInlineButton[][];
};

export function removeTelegramReplyKeyboard(): Record<string, unknown> {
  return { remove_keyboard: true };
}

export function telegramContactWithMenuKeyboard(): Record<string, unknown> {
  return {
    keyboard: [
      [{ text: "Отправить мой номер", request_contact: true }],
      [{ text: "Меню" }],
    ],
    resize_keyboard: true,
    is_persistent: false,
    one_time_keyboard: true,
  };
}

export function maxContactWithMenuInline(): NativeCreateUi {
  const draftId = NATIVE_MENU_DRAFT_HEX;
  return {
    maxInlineButtons: [
      [{ type: "request_contact", text: "Отправить мой номер" }],
      maxRow(draftId, MENU_REVISION, [{ label: "Меню", action: "menu" }]),
    ],
  };
}

/** Primary home reply keyboard (Telegram). */
export function menuReplyKeyboard(options: { showContinue?: boolean } = {}): Record<string, unknown> {
  const rows: Array<Array<{ text: string }>> = [
    [{ text: "Создать передачу" }],
    [{ text: "Мои передачи" }],
    [{ text: "Статус трека" }],
  ];
  if (options.showContinue) {
    rows.push([{ text: "Продолжить оформление" }]);
  }
  rows.push([{ text: "Меню" }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
  };
}

const MENU_REVISION = 1;

type BtnDef = { label: string; action: Parameters<typeof buildNativeCreateCallback>[0]; arg?: string };

function cbOrThrow(
  action: Parameters<typeof buildNativeCreateCallback>[0],
  draftId: string,
  revision: number,
  arg?: string,
): string {
  const payload = buildNativeCreateCallback(action, draftId, revision, arg);
  if (!payload) throw new Error("callback_payload_invalid");
  return payload;
}

function tgRow(draftId: string, revision: number, buttons: BtnDef[]) {
  return buttons.map((b) => ({
    text: b.label,
    callback_data: cbOrThrow(b.action, draftId, revision, b.arg),
  }));
}

function maxRow(draftId: string, revision: number, buttons: BtnDef[]): MaxInlineButton[] {
  return buttons.map((b) => ({
    type: "callback" as const,
    text: b.label,
    payload: cbOrThrow(b.action, draftId, revision, b.arg),
  }));
}

function wizardNav(draftId: string, revision: number, showBack: boolean): BtnDef[] {
  const row: BtnDef[] = [];
  if (showBack) row.push({ label: "◀ Назад", action: "back" });
  row.push({ label: "Отмена", action: "cancel" }, { label: "Меню", action: "menu" });
  return row;
}

function buildNavUi(
  channel: "telegram" | "max",
  draftId: string,
  revision: number,
  showBack: boolean,
): NativeCreateUi {
  const nav = wizardNav(draftId, revision, showBack);
  return channel === "telegram"
    ? { telegramInlineKeyboard: [tgRow(draftId, revision, nav)] }
    : { maxInlineButtons: [maxRow(draftId, revision, nav)] };
}

/** MAX inline for home screen; Telegram home uses reply keyboard only. */
export function buildMainMenuInline(
  channel: "telegram" | "max",
  resume?: { draftId: string; revision: number },
): NativeCreateUi {
  const draftId = NATIVE_MENU_DRAFT_HEX;
  const primary: BtnDef[] = [
    { label: "Создать передачу", action: "menu_create" },
    { label: "Мои передачи", action: "menu_my" },
    { label: "Статус трека", action: "menu_status" },
  ];
  if (channel === "telegram") {
    const rows: BtnDef[][] = [primary, [{ label: "Меню", action: "menu" }]];
    return { telegramInlineKeyboard: rows.map((row) => tgRow(draftId, MENU_REVISION, row)) };
  }
  const maxRows: MaxInlineButton[][] = primary.map((button) => maxRow(draftId, MENU_REVISION, [button]));
  if (resume) {
    const resumePayload = buildNativeCreateCallback("menu_resume", resume.draftId, resume.revision);
    if (resumePayload) {
      maxRows.unshift([{ type: "callback", text: "Продолжить оформление", payload: resumePayload }]);
    }
  }
  maxRows.push(maxRow(draftId, MENU_REVISION, [{ label: "Меню", action: "menu" }]));
  return { maxInlineButtons: maxRows };
}

/** Secondary actions panel (both channels via inline). */
export function buildCompactMenuInline(
  channel: "telegram" | "max",
  resume?: { draftId: string; revision: number },
): NativeCreateUi {
  const draftId = NATIVE_MENU_DRAFT_HEX;
  const rows: BtnDef[][] = [
    [{ label: "Получить код приёма", action: "menu_receive" }, { label: "Настройки", action: "menu_settings" }],
    [{ label: "К основным действиям", action: "menu_home" }],
  ];
  if (channel === "telegram") {
    const tgRows = rows.map((row) => tgRow(draftId, MENU_REVISION, row));
    if (resume) {
      const resumePayload = buildNativeCreateCallback("menu_resume", resume.draftId, resume.revision);
      if (resumePayload) {
        tgRows.unshift([{ text: "Продолжить оформление", callback_data: resumePayload }]);
      }
    }
    return { telegramInlineKeyboard: tgRows };
  }
  const maxRows = rows.map((row) => maxRow(draftId, MENU_REVISION, row));
  if (resume) {
    const resumePayload = buildNativeCreateCallback("menu_resume", resume.draftId, resume.revision);
    if (resumePayload) {
      maxRows.unshift([{ type: "callback", text: "Продолжить оформление", payload: resumePayload }]);
    }
  }
  return { maxInlineButtons: maxRows };
}

export function buildStepUi(
  channel: "telegram" | "max",
  draftId: string,
  revision: number,
  kind:
    | "nav"
    | "photo"
    | "comment"
    | "summary"
    | "due"
    | "recipient"
    | "edit"
    | "photo_inspect"
    | "recipient_ext_pick"
    | "recipient_ext_phone"
    | "recipient_ext_name_confirm",
  extra?: {
    recipientButtons?: Array<{ label: string; arg: string }>;
    pageNav?: { hasPrev: boolean; hasNext: boolean };
    photoSkipHidden?: boolean;
    staffExternalRecipient?: boolean;
    photoInspectButtons?: Array<{ label: string; arg: string }>;
    editFields?: Array<{ label: string; arg: string }>;
    wizardShowBack?: boolean;
    holderAction?: "forward" | "complete";
  },
): NativeCreateUi {
  const showBack = extra?.wizardShowBack !== false;
  if (kind === "photo") {
    const primary: BtnDef[] = extra?.photoSkipHidden
      ? [{ label: "Далее", action: "photo_next" }]
      : [{ label: "Без вложений", action: "photo_skip" }];
    const nav = wizardNav(draftId, revision, showBack);
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, nav)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, nav)] };
  }
  if (kind === "comment") {
    const primary: BtnDef[] = [{ label: "Пропустить", action: "comment_skip" }];
    const nav = wizardNav(draftId, revision, showBack);
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, nav)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, nav)] };
  }
  if (kind === "due") {
    const primary: BtnDef[] = [
      { label: "Сегодня", action: "due", arg: "t" },
      { label: "Завтра", action: "due", arg: "m" },
      { label: "Без срока", action: "due", arg: "n" },
    ];
    const nav = wizardNav(draftId, revision, showBack);
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, nav)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, nav)] };
  }
  if (kind === "summary") {
    if (extra?.holderAction) {
      const rows: BtnDef[][] = [
        [{ label: extra.holderAction === "complete" ? "Да, завершить трек" : "Передать дальше", action: "confirm" }],
        ...(extra.holderAction === "forward" ? [[{ label: "Изменить получателя", action: "back" } as BtnDef]] : []),
        [{ label: "Отмена", action: "cancel" }, { label: "Меню", action: "menu" }],
      ];
      return channel === "telegram"
        ? { telegramInlineKeyboard: rows.map(row => tgRow(draftId, revision, row)) }
        : { maxInlineButtons: rows.map(row => maxRow(draftId, revision, row)) };
    }
    const rows: BtnDef[][] = [[{ label: "Создать передачу", action: "confirm" }]];
    if (extra?.photoInspectButtons?.length) {
      rows.push(
        extra.photoInspectButtons.map((b) => ({
          label: b.label,
          action: "photo_view" as const,
          arg: b.arg,
        })),
      );
    }
    rows.push(
      [{ label: "Изменить", action: "edit" }],
      [{ label: "Меню", action: "menu" }],
    );
    return channel === "telegram"
      ? { telegramInlineKeyboard: rows.map((row) => tgRow(draftId, revision, row)) }
      : { maxInlineButtons: rows.map((row) => maxRow(draftId, revision, row)) };
  }
  if (kind === "edit" && extra?.editFields?.length) {
    const fields: BtnDef[] = extra.editFields.map((f) => ({
      label: f.label,
      action: "edit" as const,
      arg: f.arg,
    }));
    const tail: BtnDef[][] = [
      [{ label: "К сводке", action: "back", arg: "summary" }],
      wizardNav(draftId, revision, false),
    ];
    return channel === "telegram"
      ? {
          telegramInlineKeyboard: [
            tgRow(draftId, revision, fields),
            ...tail.map((row) => tgRow(draftId, revision, row)),
          ],
        }
      : {
          maxInlineButtons: [
            maxRow(draftId, revision, fields),
            ...tail.map((row) => maxRow(draftId, revision, row)),
          ],
        };
  }
  if (kind === "photo_inspect") {
    const tail: BtnDef[][] = [
      [{ label: "К сводке", action: "back", arg: "summary" }],
      wizardNav(draftId, revision, false),
    ];
    return channel === "telegram"
      ? { telegramInlineKeyboard: tail.map((row) => tgRow(draftId, revision, row)) }
      : { maxInlineButtons: tail.map((row) => maxRow(draftId, revision, row)) };
  }
  if (kind === "recipient_ext_phone") {
    const primary: BtnDef[] = [{ label: "Далее", action: "recipient_ext_next" }];
    const nav = wizardNav(draftId, revision, showBack);
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, nav)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, nav)] };
  }
  if (kind === "recipient_ext_name_confirm") {
    const primary: BtnDef[] = [
      { label: "Оставить имя", action: "recipient_ext_keep" },
      { label: "Изменить имя", action: "recipient_ext_change" },
    ];
    const nav = wizardNav(draftId, revision, showBack);
    return channel === "telegram"
      ? { telegramInlineKeyboard: [tgRow(draftId, revision, primary), tgRow(draftId, revision, nav)] }
      : { maxInlineButtons: [maxRow(draftId, revision, primary), maxRow(draftId, revision, nav)] };
  }
  if (kind === "recipient_ext_pick" && extra?.recipientButtons?.length) {
    const pickBtns: BtnDef[] = extra.recipientButtons.map((b) => ({
      label: b.label,
      action: "recipient_ext_tel" as const,
      arg: b.arg,
    }));
    const nav = wizardNav(draftId, revision, showBack);
    return channel === "telegram"
      ? {
          telegramInlineKeyboard: [
            tgRow(draftId, revision, pickBtns),
            tgRow(draftId, revision, nav),
          ],
        }
      : {
          maxInlineButtons: [
            maxRow(draftId, revision, pickBtns),
            maxRow(draftId, revision, nav),
          ],
        };
  }
  if (kind === "recipient") {
    const tgRows: Array<Array<{ text: string; callback_data: string }>> = [];
    const maxRows: MaxInlineButton[][] = [];
    if (extra?.recipientButtons?.length) {
      const pickBtns: BtnDef[] = extra.recipientButtons.map((b) => ({
        label: b.label,
        action: "recipient" as const,
        arg: b.arg,
      }));
      for (let i = 0; i < pickBtns.length; i += 2) {
        const slice = pickBtns.slice(i, i + 2);
        if (channel === "telegram") tgRows.push(tgRow(draftId, revision, slice));
        else maxRows.push(maxRow(draftId, revision, slice));
      }
    }
    const pageBtns: BtnDef[] = [];
    if (extra?.pageNav?.hasPrev) pageBtns.push({ label: "◀ Стр.", action: "recipient_page", arg: "p" });
    if (extra?.pageNav?.hasNext) pageBtns.push({ label: "Стр. ▶", action: "recipient_page", arg: "n" });
    if (pageBtns.length) {
      if (channel === "telegram") tgRows.push(tgRow(draftId, revision, pageBtns));
      else maxRows.push(maxRow(draftId, revision, pageBtns));
    }
    const nav = wizardNav(draftId, revision, showBack);
    if (channel === "telegram") {
      tgRows.push(tgRow(draftId, revision, nav));
      return { telegramInlineKeyboard: tgRows };
    }
    maxRows.push(maxRow(draftId, revision, nav));
    return { maxInlineButtons: maxRows };
  }
  return buildNavUi(channel, draftId, revision, showBack);
}
