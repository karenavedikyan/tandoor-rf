import type { PoolClient } from "pg";
import { listEligibleStaffForExternalParty } from "../../tan-tracker/external-request/intake-handlers";
import { listTanTrackerRecipientCatalog } from "../../tan-tracker/recipient-catalog";
import { loadAccessContext } from "../../access/context";
import { assertPartyEligibleAsRecipient } from "../../tan-tracker/party-eligibility";
import { writeAttachmentBytes } from "../../tan-tracker/attachments";
import { createPersonBrowserSession } from "../../tan-tracker/external-person/person-service";
import { getAppOrigin } from "../../config";
import crypto from "crypto";
import {
  bumpDraftRevision,
  discardNativeBotDraft,
  ensureNativeBotDraft,
  loadNativeBotDraft,
  type NativeCreateDraftPayload,
} from "./draft-scope";
import { buildMainMenuInline, buildStepUi, menuReplyKeyboard } from "./keyboards";
import {
  draftIdMatchesHex,
  parseNativeCreateCallback,
  type ParsedNativeCreateCallback,
} from "./callback-codec";
import { confirmNativeExternalDraft, confirmNativeStaffDraft } from "./confirm-native";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";
import {
  assertDraftBoundToCaller,
  assertDraftPersonRow,
  assertNativeCreateContext,
  lockNativeCreateMessenger,
} from "./access-guard";
import { type NativeReplyMediaItem, nativeMediaQueueFromDraftPhoto } from "./reply-media";
import { isNativeMenuDraftHex, NATIVE_MENU_DRAFT_HEX } from "./menu-sentinel";
import {
  parseRecipientContactFromTelegram,
  parseRecipientContactFromVcf,
  type ParsedRecipientContact,
} from "./recipient-contact-parse";

export type NativeCreateReply = {
  text: string;
  requestContact?: boolean;
  replyMarkup?: Record<string, unknown>;
  telegramInlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
  maxInlineButtons?: import("../../tanbot-max/delivery-transport").MaxInlineButton[][];
  /** Provider-backed photos to deliver after the text reply (additive for reply_extra merge). */
  nativeMediaQueue?: NativeReplyMediaItem[];
};

export type NativeCreateContext = {
  channel: "telegram" | "max";
  messengerChatId: string;
  messengerUserId: bigint;
  privateDialogOk: boolean;
  isLinkedStaff: boolean;
  staffUserId: string | null;
  personId: string | null;
};

const CREATE_TRIGGERS = new Set(["создать передачу", "/send", "/create", "/create@", "отправить предмет"]);

export function isNativeCreateMenuText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (CREATE_TRIGGERS.has(t)) return true;
  return t.startsWith("/send") || t.startsWith("/create");
}

export function isNativeCreateCallback(data: string): boolean {
  return parseNativeCreateCallback(data) != null;
}

const RECIPIENT_PAGE = 6;

function navError(message: string, channel: "telegram" | "max"): NativeCreateReply {
  const menu = buildMainMenuInline(channel);
  return {
    text: message,
    replyMarkup: menuReplyKeyboard(),
    telegramInlineKeyboard: menu.telegramInlineKeyboard,
    maxInlineButtons: menu.maxInlineButtons,
  };
}

function stepPrompt(step: string, payload: NativeCreateDraftPayload, photoCount: number): string {
  switch (step) {
    case "item":
      return "Что передаёте? Кратко опишите предмет (до 500 символов).";
    case "photo":
      return photoCount > 0
        ? `Фото: ${photoCount}/5. Пришлите ещё или нажмите «Далее». «Пропустить» доступно только без фото.`
        : "Пришлите до 5 фото (по 8 МБ) или нажмите «Пропустить».";
    case "comment":
      return "Комментарий к передаче или нажмите «Пропустить».";
    case "recipient":
      return payload.recipientSearchQuery
        ? `Получатели (поиск «${payload.recipientSearchQuery}»). Выберите кнопкой или уточните текст.`
        : "Выберите получателя кнопкой ниже.";
    case "recipient_ext_name":
      return (
        "Имя внешнего получателя.\n" +
        "Введите текстом или отправьте контакт через скрепку → «Контакт» (не кнопку «Отправить мой номер»)."
      );
    case "recipient_ext_phone": {
      const ext = payload.recipientExternal;
      const lines = [
        "Телефон получателя: введите цифрами, отправьте контакт из телефонной книги или нажмите «Далее».",
      ];
      if (ext?.name?.trim()) lines.push(`Имя: ${ext.name.trim()}.`);
      if (ext?.phone) lines.push(`Телефон: ${ext.phone}.`);
      return lines.join("\n");
    }
    case "due":
      return "Выберите срок передачи.";
    case "edit":
      return "Что изменить?";
    case "summary":
      return formatSummary(payload, photoCount);
    default:
      return "Продолжите оформление передачи.";
  }
}

function formatSummary(payload: NativeCreateDraftPayload, photoCount: number): string {
  const due =
    payload.dueMode === "tomorrow" ? "завтра" : payload.dueMode === "none" ? "без срока" : "сегодня";
  const recipient =
    payload.recipientDisplayName ??
    payload.recipientExternal?.name ??
    payload.eligibleRecipients?.find((c) => c.userId === payload.recipientUserId)?.fullName ??
    payload.eligibleRecipients?.find((c) => c.userId === payload.recipientPartyId)?.fullName ??
    "—";
  return (
    "Проверьте данные:\n" +
    `• Предмет: ${payload.item ?? "—"}\n` +
    `• Получатель: ${recipient}\n` +
    `• Комментарий: ${payload.comment?.trim() ? payload.comment : "—"}\n` +
    `• Срок: ${due}\n` +
    `• Фото: ${photoCount}`
  );
}

async function photoCount(client: PoolClient, draftId: string): Promise<number> {
  const c = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draftId],
  );
  return c.rows[0]?.n ?? 0;
}

async function listDraftPhotoMeta(
  client: PoolClient,
  draftId: string,
): Promise<Array<{ sortOrder: number; fileName: string }>> {
  const c = await client.query<{ sort_order: number; file_name: string }>(
    `SELECT sort_order, file_name FROM tt_external_request_draft_files WHERE draft_id = $1::uuid ORDER BY sort_order`,
    [draftId],
  );
  return c.rows.map((r) => ({ sortOrder: r.sort_order, fileName: r.file_name }));
}

function filteredRecipients(payload: NativeCreateDraftPayload): Array<{ userId: string; fullName: string }> {
  const all = payload.eligibleRecipients ?? [];
  const q = payload.recipientSearchQuery?.trim().toLowerCase();
  if (!q) return all;
  return all.filter((c) => c.fullName.toLowerCase().includes(q));
}

async function renderDraftPrompt(
  client: PoolClient,
  channel: "telegram" | "max",
  draftId: string,
  step: string,
  payload: NativeCreateDraftPayload,
): Promise<NativeCreateReply> {
  const count = await photoCount(client, draftId);
  const text = stepPrompt(step, payload, count);
  let ui = buildStepUi(channel, draftId, payload.revision ?? 1, "nav");
  if (step === "photo") {
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "photo", { photoSkipHidden: count > 0 });
  } else if (step === "comment") {
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "comment");
  } else if (step === "due") {
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "due");
  } else if (step === "edit") {
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "edit", {
      editFields: [
        { label: "Предмет", arg: "item" },
        { label: "Фото", arg: "photo" },
        { label: "Комментарий", arg: "comment" },
        { label: "Получатель", arg: "recipient" },
        { label: "Срок", arg: "due" },
      ],
    });
  } else if (step === "summary") {
    const photos = count > 0 ? await listDraftPhotoMeta(client, draftId) : [];
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "summary", {
      photoInspectButtons: photos.map((p) => ({
        label: `Фото ${p.sortOrder + 1}`,
        arg: String(p.sortOrder),
      })),
    });
  } else if (step === "recipient") {
    const page = payload.recipientPage ?? 0;
    const choices = filteredRecipients(payload);
    const slice = choices.slice(page * RECIPIENT_PAGE, (page + 1) * RECIPIENT_PAGE);
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "recipient", {
      recipientButtons: slice.map((c, i) => ({
        label: c.fullName.slice(0, 40),
        arg: String(page * RECIPIENT_PAGE + i),
      })),
      pageNav: {
        hasPrev: page > 0,
        hasNext: (page + 1) * RECIPIENT_PAGE < choices.length,
      },
      staffExternalRecipient: payload.actor === "staff",
    });
  } else if (step === "recipient_ext_phone") {
    const ext = payload.recipientExternal;
    if (ext?.phone && ext.name?.trim()) {
      ui = buildStepUi(channel, draftId, payload.revision ?? 1, "recipient_ext_phone");
    }
  }
  return {
    text,
    replyMarkup: menuReplyKeyboard(),
    telegramInlineKeyboard: channel === "telegram" ? ui.telegramInlineKeyboard : undefined,
    maxInlineButtons: channel === "max" ? ui.maxInlineButtons : undefined,
  };
}

async function loadRecipientChoices(
  client: PoolClient,
  ctx: NativeCreateContext,
  payload: NativeCreateDraftPayload,
): Promise<Array<{ userId: string; fullName: string }>> {
  if (payload.actor === "external") {
    if (!ctx.personId) return [];
    const party = await client.query<{ party_id: string }>(
      `SELECT party_id::text FROM tt_external_persons WHERE id = $1::uuid`,
      [ctx.personId],
    );
    const partyId = party.rows[0]?.party_id;
    if (!partyId) return [];
    return listEligibleStaffForExternalParty(client, partyId);
  }
  if (!ctx.staffUserId) return [];
  const catalog = await listTanTrackerRecipientCatalog(client, ctx.staffUserId);
  const access = await loadAccessContext(ctx.staffUserId, undefined, client);
  const out: Array<{ userId: string; fullName: string }> = [];
  for (const c of catalog) {
    try {
      await assertPartyEligibleAsRecipient(client, access, ctx.staffUserId, c.id);
      out.push({ userId: c.id, fullName: c.name });
    } catch {
      /* skip ineligible */
    }
  }
  return out;
}

async function myTransfersReply(client: PoolClient, ctx: NativeCreateContext): Promise<NativeCreateReply> {
  if (ctx.isLinkedStaff && ctx.staffUserId) {
    const origin = getAppOrigin() ?? "https://example.invalid";
    return {
      text: `Мои передачи в личном кабинете:\n${origin}/tan-tracker/`,
      replyMarkup: menuReplyKeyboard(),
    };
  }
  if (!ctx.personId) {
    return { text: "Подтвердите номер телефона, чтобы открыть передачи.", requestContact: true };
  }
  const sessionRaw = await createPersonBrowserSession(client, ctx.personId, ctx.channel);
  const origin = getAppOrigin() ?? "https://example.invalid";
  return {
    text: `Мои передачи:\n${origin}/tan-tracker/?est=${encodeURIComponent(sessionRaw)}`,
    replyMarkup: menuReplyKeyboard(),
  };
}

async function startOrResumeCreate(client: PoolClient, ctx: NativeCreateContext): Promise<NativeCreateReply> {
  if (!ctx.privateDialogOk) {
    return navError("Создание передачи доступно только в личном чате с ботом.", ctx.channel);
  }
  const actor = ctx.isLinkedStaff ? "staff" : "external";
  if (actor === "external" && !ctx.personId) {
    return { text: "Подтвердите номер телефона, чтобы создать передачу.", requestContact: true };
  }
  if (actor === "staff" && !ctx.staffUserId) {
    return navError("Профиль сотрудника недоступен.", ctx.channel);
  }
  const draft = await ensureNativeBotDraft(client, {
    channel: ctx.channel,
    messengerChatId: ctx.messengerChatId,
    actor,
    personId: ctx.personId,
    staffUserId: ctx.staffUserId ?? undefined,
  });
  const payload = draft.payload as NativeCreateDraftPayload;
  assertDraftBoundToCaller(payload, ctx);
  return renderDraftPrompt(client, ctx.channel, draft.id, draft.step, payload);
}

function callbackAllowedForStep(action: ParsedNativeCreateCallback["action"], step: string): boolean {
  switch (action) {
    case "confirm":
      return step === "summary";
    case "due":
      return step === "due";
    case "recipient":
    case "recipient_page":
    case "recipient_ext":
      return step === "recipient";
    case "recipient_ext_tel":
      return step === "recipient_ext_name" || step === "recipient_ext_phone";
    case "recipient_ext_next":
      return step === "recipient_ext_phone";
    case "photo_skip":
    case "photo_next":
      return step === "photo";
    case "photo_view":
      return step === "summary";
    case "comment_skip":
      return step === "comment";
    case "edit":
      return step === "summary" || step === "edit";
    case "back":
    case "cancel":
    case "restart":
    case "menu":
      return true;
    default:
      return false;
  }
}

async function resolveDraftForCallback(
  client: PoolClient,
  ctx: NativeCreateContext,
  parsed: ParsedNativeCreateCallback,
): Promise<{ id: string; step: string; payload: NativeCreateDraftPayload } | null> {
  if (isNativeMenuDraftHex(parsed.draftIdHex)) return null;
  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor, { forUpdate: true });
  if (!draft) return null;
  if (!draftIdMatchesHex(draft.id, parsed.draftIdHex)) return null;
  if (actor === "external" && draft.person_id && ctx.personId && draft.person_id !== ctx.personId) return null;
  const payload = draft.payload as NativeCreateDraftPayload;
  assertDraftBoundToCaller(payload, ctx);
  if ((payload.revision ?? 0) !== parsed.revision) return null;
  return { id: draft.id, step: draft.step, payload };
}

async function advanceAfterComment(
  client: PoolClient,
  ctx: NativeCreateContext,
  draftId: string,
  payload: NativeCreateDraftPayload,
): Promise<NativeCreateReply> {
  if (payload.editReturnStep === "summary") {
    const nextPayload = await bumpDraftRevision(client, draftId, "summary", payload);
    return renderDraftPrompt(client, ctx.channel, draftId, "summary", nextPayload);
  }
  const choices = await loadRecipientChoices(client, ctx, payload);
  if (!choices.length) {
    return navError("Нет доступных получателей. Обратитесь к менеджеру.", ctx.channel);
  }
  payload.eligibleRecipients = choices;
  payload.recipientPage = 0;
  payload.recipientSearchQuery = undefined;
  const nextPayload = await bumpDraftRevision(client, draftId, "recipient", payload);
  return renderDraftPrompt(client, ctx.channel, draftId, "recipient", nextPayload);
}

async function pickRecipientByIndex(
  client: PoolClient,
  ctx: NativeCreateContext,
  id: string,
  step: string,
  payload: NativeCreateDraftPayload,
  idx: number,
): Promise<NativeCreateReply> {
  const choices = filteredRecipients(payload);
  const pick = choices[idx];
  if (!pick) {
    return navError("Получатель недоступен. Выберите из списка.", ctx.channel);
  }
  const displayName = pick.fullName;
  const nextStep = payload.editReturnStep === "summary" ? "summary" : "due";
  const nextPayload = await bumpDraftRevision(client, id, nextStep, {
    ...payload,
    recipientDisplayName: displayName,
    ...(payload.actor === "external"
      ? { recipientUserId: pick.userId }
      : { recipientPartyId: pick.userId, recipientUserId: undefined }),
  });
  return renderDraftPrompt(client, ctx.channel, id, nextStep, nextPayload);
}

export async function handleNativeCreateCallback(
  client: PoolClient,
  ctx: NativeCreateContext,
  callbackData: string,
): Promise<NativeCreateReply | null> {
  const parsed = parseNativeCreateCallback(callbackData);
  if (!parsed) return null;

  await lockNativeCreateMessenger(client, ctx);

  if (parsed.action === "menu_create" || parsed.action === "menu_my") {
    if (!isNativeMenuDraftHex(parsed.draftIdHex)) return null;
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Действие недоступно.";
      return navError(message, ctx.channel);
    }
    if (parsed.action === "menu_create") return startOrResumeCreate(client, ctx);
    return myTransfersReply(client, ctx);
  }

  try {
    await assertNativeCreateContext(client, ctx);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Действие недоступно.";
    return navError(message, ctx.channel);
  }

  const draft = await resolveDraftForCallback(client, ctx, parsed);
  if (!draft) {
    return navError("Действие устарело. Нажмите «Создать передачу» снова.", ctx.channel);
  }

  const { id, step, payload } = draft;

  if (!callbackAllowedForStep(parsed.action, step) && parsed.action !== "menu") {
    return renderDraftPrompt(client, ctx.channel, id, step, payload);
  }

  if (parsed.action === "menu") {
    const menu = buildMainMenuInline(ctx.channel);
    return {
      text: "Главное меню.",
      replyMarkup: menuReplyKeyboard(),
      telegramInlineKeyboard: menu.telegramInlineKeyboard,
      maxInlineButtons: menu.maxInlineButtons,
    };
  }

  if (parsed.action === "cancel" || parsed.action === "restart") {
    await discardNativeBotDraft(client, id);
    if (parsed.action === "restart") return startOrResumeCreate(client, ctx);
    return { text: "Черновик отменён.", replyMarkup: menuReplyKeyboard() };
  }

  if (parsed.action === "back") {
    if (parsed.arg === "summary" && step !== "summary") {
      const nextPayload = await bumpDraftRevision(client, id, "summary", payload);
      return renderDraftPrompt(client, ctx.channel, id, "summary", nextPayload);
    }
    const prev =
      step === "photo"
        ? "item"
        : step === "comment"
          ? "photo"
          : step === "recipient" || step === "recipient_ext_name" || step === "recipient_ext_phone"
            ? "comment"
            : step === "due"
              ? "recipient"
              : step === "summary"
                ? "due"
                : step === "edit"
                  ? "summary"
                  : "item";
    const nextPayload = await bumpDraftRevision(client, id, prev, payload);
    return renderDraftPrompt(client, ctx.channel, id, prev, nextPayload);
  }

  if (parsed.action === "photo_skip") {
    const count = await photoCount(client, id);
    if (count > 0) return renderDraftPrompt(client, ctx.channel, id, step, payload);
    const nextStep = payload.editReturnStep === "summary" ? "summary" : "comment";
    const nextPayload = await bumpDraftRevision(client, id, nextStep, payload);
    return renderDraftPrompt(client, ctx.channel, id, nextStep, nextPayload);
  }

  if (parsed.action === "photo_next") {
    const nextStep = payload.editReturnStep === "summary" ? "summary" : "comment";
    const nextPayload = await bumpDraftRevision(client, id, nextStep, payload);
    return renderDraftPrompt(client, ctx.channel, id, nextStep, nextPayload);
  }

  if (parsed.action === "comment_skip") {
    return advanceAfterComment(client, ctx, id, { ...payload, comment: "" });
  }

  if (parsed.action === "due" && parsed.arg) {
    const mode = parsed.arg === "m" ? "tomorrow" : parsed.arg === "n" ? "none" : "today";
    const nextStep = payload.editReturnStep === "summary" || step === "due" ? "summary" : "summary";
    const nextPayload = await bumpDraftRevision(client, id, nextStep, { ...payload, dueMode: mode });
    return renderDraftPrompt(client, ctx.channel, id, nextStep, nextPayload);
  }

  if (parsed.action === "recipient" && parsed.arg != null) {
    const idx = Number(parsed.arg);
    if (!Number.isInteger(idx) || idx < 0) return renderDraftPrompt(client, ctx.channel, id, step, payload);
    return pickRecipientByIndex(client, ctx, id, step, payload, idx);
  }

  if (parsed.action === "recipient_ext") {
    if (payload.actor !== "staff") return renderDraftPrompt(client, ctx.channel, id, step, payload);
    const nextPayload = await bumpDraftRevision(client, id, "recipient_ext_name", payload);
    return renderDraftPrompt(client, ctx.channel, id, "recipient_ext_name", nextPayload);
  }

  if (parsed.action === "recipient_ext_tel" && parsed.arg != null) {
    const idx = Number(parsed.arg);
    const options = payload.recipientPhonePickOptions ?? [];
    const phone = options[idx];
    if (!phone) return renderDraftPrompt(client, ctx.channel, id, step, payload);
    delete payload.recipientPhonePickOptions;
    const mode = step === "recipient_ext_phone" ? "phone_only" : "contact_first";
    return applyRecipientContactData(client, ctx, id, step, payload, {
      phonesE164: [phone],
      suggestedName: payload.recipientExternal?.name ?? null,
    }, mode);
  }

  if (parsed.action === "recipient_ext_next") {
    const ext = payload.recipientExternal;
    if (!ext?.phone || !ext.name?.trim()) {
      return navError("Укажите имя и телефон получателя.", ctx.channel);
    }
    delete payload.recipientPhonePickOptions;
    payload.recipientDisplayName = ext.name.trim();
    const nextPayload = await bumpDraftRevision(client, id, "due", payload);
    return renderDraftPrompt(client, ctx.channel, id, "due", nextPayload);
  }

  if (parsed.action === "recipient_page") {
    const page = payload.recipientPage ?? 0;
    const nextPage = parsed.arg === "n" ? page + 1 : Math.max(0, page - 1);
    const nextPayload = await bumpDraftRevision(client, id, step, { ...payload, recipientPage: nextPage });
    return renderDraftPrompt(client, ctx.channel, id, "recipient", nextPayload);
  }

  if (parsed.action === "edit") {
    if (step === "summary" && !parsed.arg) {
      const nextPayload = await bumpDraftRevision(client, id, "edit", payload);
      return renderDraftPrompt(client, ctx.channel, id, "edit", nextPayload);
    }
    if (step === "edit" && parsed.arg) {
      const field = parsed.arg;
      if (field === "recipient") {
        const choices = await loadRecipientChoices(client, ctx, payload);
        if (!choices.length) return navError("Нет доступных получателей.", ctx.channel);
        payload.eligibleRecipients = choices;
        payload.recipientPage = 0;
      }
      const nextPayload = await bumpDraftRevision(client, id, field, { ...payload, editReturnStep: "summary" });
      return renderDraftPrompt(client, ctx.channel, id, field, nextPayload);
    }
    return renderDraftPrompt(client, ctx.channel, id, step, payload);
  }

  if (parsed.action === "photo_view" && parsed.arg != null) {
    const sortOrder = Number(parsed.arg);
    const files = await client.query<{
      storage_key: string;
      mime_type: string;
      file_name: string;
      telegram_file_id: string | null;
      max_file_token: string | null;
    }>(
      `SELECT storage_key, mime_type, file_name, telegram_file_id, max_file_token FROM tt_external_request_draft_files
       WHERE draft_id = $1::uuid AND sort_order = $2`,
      [id, sortOrder],
    );
    const file = files.rows[0];
    if (!file) return renderDraftPrompt(client, ctx.channel, id, step, payload);
    const media = nativeMediaQueueFromDraftPhoto({
      channel: ctx.channel,
      draftId: id,
      sortOrder,
      fileName: file.file_name,
      mimeType: file.mime_type,
      telegramFileId: file.telegram_file_id,
      maxFileToken: file.max_file_token,
    });
    if (!media) {
      return navError("Фото недоступно для предпросмотра. Добавьте снимок заново.", ctx.channel);
    }
    const ui = buildStepUi(ctx.channel, id, payload.revision ?? 1, "photo_inspect");
    return {
      text: `Фото ${sortOrder + 1}: ${file.file_name}`,
      replyMarkup: menuReplyKeyboard(),
      telegramInlineKeyboard: ui.telegramInlineKeyboard,
      maxInlineButtons: ui.maxInlineButtons,
      nativeMediaQueue: [media],
    };
  }

  if (parsed.action === "confirm") {
    if (step !== "summary") return renderDraftPrompt(client, ctx.channel, id, step, payload);
    try {
      if (payload.actor === "staff" && ctx.staffUserId) {
        const created = await confirmNativeStaffDraft(client, {
          staffUserId: ctx.staffUserId,
          draftId: id,
          payload,
          channel: ctx.channel,
        });
        return { text: created.resultText, replyMarkup: menuReplyKeyboard() };
      }
      if (payload.actor === "external" && ctx.personId) {
        const party = await client.query<{ party_id: string }>(
          `SELECT party_id::text FROM tt_external_persons WHERE id = $1::uuid`,
          [ctx.personId],
        );
        const partyId = party.rows[0]?.party_id;
        if (!partyId) return { text: "Профиль недоступен.", requestContact: true };
        const created = await confirmNativeExternalDraft(client, {
          personId: ctx.personId,
          externalPartyId: partyId,
          draftId: id,
        });
        return {
          text: `Заявка отправлена: ${created.publicCode}. Сотрудник получит уведомление.`,
          replyMarkup: menuReplyKeyboard(),
        };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Не удалось создать передачу.";
      return navError(message, ctx.channel);
    }
  }

  return renderDraftPrompt(client, ctx.channel, id, step, payload);
}

export async function handleNativeCreateMessage(
  client: PoolClient,
  ctx: NativeCreateContext,
  text: string,
): Promise<NativeCreateReply | null> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "мои передачи" || lower.startsWith("/my")) {
    await lockNativeCreateMessenger(client, ctx);
    try {
      await assertNativeCreateContext(client, ctx);
    } catch {
      return null;
    }
    return myTransfersReply(client, ctx);
  }

  if (isNativeCreateMenuText(trimmed)) {
    await lockNativeCreateMessenger(client, ctx);
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Создание недоступно.";
      return navError(message, ctx.channel);
    }
    return startOrResumeCreate(client, ctx);
  }

  await lockNativeCreateMessenger(client, ctx);
  try {
    await assertNativeCreateContext(client, ctx);
  } catch {
    return null;
  }

  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor, { forUpdate: true });
  if (!draft) return null;
  assertDraftPersonRow(draft, ctx);

  const payload = { ...(draft.payload as NativeCreateDraftPayload) };
  assertDraftBoundToCaller(payload, ctx);
  const step = draft.step;

  if (step === "item") {
    const item = trimmed.slice(0, 500);
    if (!item) return navError("Укажите название предмета.", ctx.channel);
    payload.item = item;
    const nextStep = payload.editReturnStep === "summary" ? "summary" : "photo";
    const nextPayload = await bumpDraftRevision(client, draft.id, nextStep, payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, nextStep, nextPayload);
  }

  if (step === "photo") {
    const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, step, payload);
    return { ...rendered, text: "На этом шаге отправьте фото или используйте кнопки «Далее» / «Пропустить»." };
  }

  if (step === "comment") {
    payload.comment = trimmed.slice(0, 2000);
    return advanceAfterComment(client, ctx, draft.id, payload);
  }

  if (step === "recipient") {
    payload.recipientSearchQuery = trimmed.slice(0, 64);
    payload.recipientPage = 0;
    const nextPayload = await bumpDraftRevision(client, draft.id, step, payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "recipient", nextPayload);
  }

  if (step === "recipient_ext_name") {
    payload.recipientExternal = { name: trimmed.slice(0, 120), phone: payload.recipientExternal?.phone ?? "" };
    const nextPayload = await bumpDraftRevision(client, draft.id, "recipient_ext_phone", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "recipient_ext_phone", nextPayload);
  }

  if (step === "recipient_ext_phone") {
    const phone = normalizeRuPhoneE164(trimmed);
    if (!phone) return navError("Введите телефон: 10 цифр после +7.", ctx.channel);
    delete payload.recipientPhonePickOptions;
    payload.recipientExternal = {
      name: payload.recipientExternal?.name ?? "",
      phone,
    };
    payload.recipientPartyId = undefined;
    payload.recipientUserId = undefined;
    payload.recipientDisplayName = payload.recipientExternal.name;
    const nextPayload = await bumpDraftRevision(client, draft.id, "due", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "due", nextPayload);
  }

  if (step === "edit" || step === "due" || step === "summary") {
    return renderDraftPrompt(client, ctx.channel, draft.id, step, payload);
  }

  return renderDraftPrompt(client, ctx.channel, draft.id, step, payload);
}

export async function handleNativeCreatePhoto(
  client: PoolClient,
  ctx: NativeCreateContext,
  input: {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    telegramFileId?: string | null;
    maxFileToken?: string | null;
  },
): Promise<NativeCreateReply | null> {
  await lockNativeCreateMessenger(client, ctx);
  try {
    await assertNativeCreateContext(client, ctx);
  } catch {
    return null;
  }

  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor, { forUpdate: true });
  if (!draft || draft.step !== "photo") return null;
  assertDraftPersonRow(draft, ctx);
  const payload = draft.payload as NativeCreateDraftPayload;
  assertDraftBoundToCaller(payload, ctx);

  const count = await photoCount(client, draft.id);
  if (count >= 5) {
    return navError("Не более 5 фото. Нажмите «Далее».", ctx.channel);
  }
  if (input.buffer.length > 8 * 1024 * 1024) {
    return navError("Фото больше 8 МБ. Отправьте файл меньше.", ctx.channel);
  }
  const mime = input.mimeType?.toLowerCase() ?? "";
  if (!mime.startsWith("image/")) {
    return navError("Нужен файл изображения.", ctx.channel);
  }

  const key = `native-draft/${draft.id}/${crypto.randomUUID()}-${input.fileName}`;
  await writeAttachmentBytes(client, key, input.buffer);
  await client.query(
    `INSERT INTO tt_external_request_draft_files (
       draft_id, storage_key, file_name, mime_type, byte_size, sort_order, telegram_file_id, max_file_token)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
    [
      draft.id,
      key,
      input.fileName,
      input.mimeType,
      input.buffer.length,
      count,
      input.telegramFileId?.trim() || null,
      input.maxFileToken?.trim() || null,
    ],
  );
  const nextPayload = await bumpDraftRevision(client, draft.id, "photo", payload);
  return renderDraftPrompt(client, ctx.channel, draft.id, "photo", nextPayload);
}

async function applyRecipientContactData(
  client: PoolClient,
  ctx: NativeCreateContext,
  draftId: string,
  step: string,
  payload: NativeCreateDraftPayload,
  parsed: ParsedRecipientContact,
  mode: "contact_first" | "phone_only",
): Promise<NativeCreateReply> {
  const phones = parsed.phonesE164;
  if (phones.length > 1) {
    payload.recipientPhonePickOptions = phones;
    const nextPayload = await bumpDraftRevision(client, draftId, step, payload);
    const pickButtons = phones.map((p, i) => ({
      label: p.length > 14 ? `${p.slice(0, 8)}…${p.slice(-4)}` : p,
      arg: String(i),
    }));
    const ui = buildStepUi(ctx.channel, draftId, nextPayload.revision ?? 1, "recipient_ext_pick", {
      recipientButtons: pickButtons,
    });
    const rendered = await renderDraftPrompt(client, ctx.channel, draftId, step, nextPayload);
    return {
      ...rendered,
      text:
        `${rendered.text}\n\n` +
        `В контакте несколько номеров. Выберите нужный кнопкой или отправьте контакт с одним номером.`,
      telegramInlineKeyboard: ui.telegramInlineKeyboard ?? rendered.telegramInlineKeyboard,
      maxInlineButtons: ui.maxInlineButtons ?? rendered.maxInlineButtons,
    };
  }
  const phone = phones[0]!;
  delete payload.recipientPhonePickOptions;
  if (mode === "phone_only") {
    payload.recipientExternal = {
      name: payload.recipientExternal?.name ?? "",
      phone,
    };
  } else {
    const name =
      payload.recipientExternal?.name?.trim() ||
      parsed.suggestedName ||
      "";
    payload.recipientExternal = { name, phone };
  }
  payload.recipientPartyId = undefined;
  payload.recipientUserId = undefined;
  payload.recipientDisplayName = payload.recipientExternal.name || undefined;

  if (mode === "contact_first" && !payload.recipientExternal.name.trim()) {
    const nextPayload = await bumpDraftRevision(client, draftId, "recipient_ext_name", payload);
    return renderDraftPrompt(client, ctx.channel, draftId, "recipient_ext_name", nextPayload);
  }
  const nextPayload = await bumpDraftRevision(client, draftId, "recipient_ext_phone", payload);
  return renderDraftPrompt(client, ctx.channel, draftId, "recipient_ext_phone", nextPayload);
}

export async function tryHandleNativeCreateRecipientContact(
  client: PoolClient,
  ctx: NativeCreateContext,
  input:
    | {
        kind: "telegram";
        phoneRaw: string;
        firstName?: string | null;
        lastName?: string | null;
        vcard?: string | null;
        isForwarded: boolean;
      }
    | { kind: "max"; vcfInfo: string; isForwarded: boolean },
): Promise<NativeCreateReply | null> {
  if (!ctx.isLinkedStaff || !ctx.privateDialogOk) return null;
  if (input.isForwarded) return null;

  await lockNativeCreateMessenger(client, ctx);
  try {
    await assertNativeCreateContext(client, ctx);
  } catch {
    return null;
  }

  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, "staff", { forUpdate: true });
  if (!draft) return null;
  assertDraftPersonRow(draft, ctx);
  const payload = { ...(draft.payload as NativeCreateDraftPayload) };
  assertDraftBoundToCaller(payload, ctx);
  if (payload.actor !== "staff") return null;

  const step = draft.step;
  if (step !== "recipient_ext_name" && step !== "recipient_ext_phone") return null;

  const parsed =
    input.kind === "telegram"
      ? parseRecipientContactFromTelegram(input)
      : parseRecipientContactFromVcf(input.vcfInfo);
  if (!parsed.ok) {
    return navError(parsed.message, ctx.channel);
  }

  return applyRecipientContactData(
    client,
    ctx,
    draft.id,
    step,
    payload,
    parsed.data,
    step === "recipient_ext_phone" ? "phone_only" : "contact_first",
  );
}
