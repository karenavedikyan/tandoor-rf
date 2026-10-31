import type { PoolClient } from "pg";
import { createPersonBrowserSession } from "../../tan-tracker/external-person/person-service";
import { getAppOrigin } from "../../config";
import {
  bumpDraftRevision,
  clearExternalRecipientTarget,
  clearStaffRecipientTarget,
  discardNativeBotDraft,
  ensureNativeBotDraft,
  loadNativeBotDraft,
  stripTransientRecipientDraftFields,
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
import type { NativeReplyMediaItem } from "./reply-media";
import { readNativeAttachmentTransportKind, recordNativeAttachmentTransportKind } from "./native-attachment-transport-kind";
import { isNativeMenuDraftHex, NATIVE_MENU_DRAFT_HEX } from "./menu-sentinel";
import {
  parseRecipientContactFromTelegram,
  parseRecipientContactFromVcf,
  type ParsedRecipientContact,
} from "./recipient-contact-parse";
import {
  RECIPIENT_PAGE_SIZE,
  externalRecipientNamePrompt,
  externalSummaryDisplayName,
  externalUnavailableMessage,
  findExistingExternalByPhone,
  handleExternalRecipientPhoneText,
  handleStaffRecipientSearchText,
  hitsToEligibleRecipients,
  resolveExternalIntakeStaffUserId,
  recipientStepPrompt,
  revalidateStaffRecipientPick,
  searchStaffRecipientHits,
} from "./recipient-unified";
import { userIdFromPendingUserPartyRef } from "../../tan-tracker/recipient-catalog";
import { isUuid } from "../../tan-tracker/phone-normalize";

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

export {
  buildNativeMainMenuReply,
  nativeCompletionMenuReply,
  nativeVerifiedContactRequiredReply,
  parseNativeBotSlashCommand,
  isNativeMainMenuText,
  isNativeContinueDraftText,
} from "./main-menu";

export function isNativeCreateCallback(data: string): boolean {
  return parseNativeCreateCallback(data) != null;
}

export function navError(message: string, channel: "telegram" | "max"): NativeCreateReply {
  return {
    text: message,
    replyMarkup: menuReplyKeyboard(),
    telegramInlineKeyboard: undefined,
    maxInlineButtons: channel === "max" ? buildMainMenuInline("max").maxInlineButtons : undefined,
  };
}

async function resumeOwnedNativeDraft(
  client: PoolClient,
  ctx: NativeCreateContext,
): Promise<NativeCreateReply | null> {
  const { peekResumableNativeDraft } = await import("./main-menu");
  const draft = await peekResumableNativeDraft(client, ctx);
  if (!draft) return null;
  const payload = draft.payload as NativeCreateDraftPayload;
  return renderDraftPrompt(client, ctx.channel, draft.id, draft.step, payload);
}

function stepPrompt(
  step: string,
  payload: NativeCreateDraftPayload,
  attachmentStats: { total: number; imageCount: number; pdfCount: number; otherCount: number },
): string {
  const photoCount = attachmentStats.total;
  const genericDraft = attachmentStats.pdfCount > 0 || attachmentStats.otherCount > 0;
  switch (step) {
    case "item":
      return "Что передаёте? Кратко опишите предмет (до 500 символов).";
    case "photo":
      if (photoCount > 0) {
        const countLine = genericDraft ? `Файлы: ${photoCount}/5.` : `Фото: ${photoCount}/5.`;
        return `${countLine} Пришлите ещё вложения или нажмите «Далее». «Пропустить» доступно только без вложений.`;
      }
      return (
        "Вложения: пришлите фото или любые файлы — PDF, Word, Excel, архивы, видео (до 5 по 8 МБ каждый). " +
        "После добавления нажмите «Далее» или «Пропустить», если вложения не нужны."
      );
    case "comment":
      return "Комментарий к передаче или нажмите «Пропустить».";
    case "recipient":
      return recipientStepPrompt(payload, payload.actor === "staff" ? "staff" : "external");
    case "recipient_ext_name": {
      if (payload.actor === "external") {
        return externalRecipientNamePrompt(payload);
      }
      if (payload.recipientExtAwaitNameConfirm && payload.recipientExternal?.phone) {
        const ext = payload.recipientExternal;
        return (
          `Контакт получателя:\n` +
          `Имя: ${ext.name?.trim() || "—"}\n` +
          `Телефон: ${ext.phone}\n\n` +
          `Имя можно изменить — введите другое текстом или подтвердите кнопкой.`
        );
      }
      const hasPhone = Boolean(payload.recipientExternal?.phone);
      return (
        "Имя внешнего получателя.\n" +
        (hasPhone
          ? "Телефон уже выбран — введите имя текстом.\n"
          : "Введите текстом или отправьте контакт через скрепку → «Контакт» (не кнопку «Отправить мой номер»).")
      );
    }
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
      return formatSummary(payload, attachmentStats);
    default:
      return "Продолжите оформление передачи.";
  }
}

function formatSummary(
  payload: NativeCreateDraftPayload,
  attachmentStats: { total: number; imageCount: number; pdfCount: number; otherCount: number },
): string {
  const photoCount = attachmentStats.total;
  const genericSummary = attachmentStats.pdfCount > 0 || attachmentStats.otherCount > 0;
  const due =
    payload.dueMode === "tomorrow" ? "завтра" : payload.dueMode === "none" ? "без срока" : "сегодня";
  let recipient = "—";
  let recipientPhone: string | undefined;
  if (payload.actor === "external") {
    const trustedName = payload.externalRecipientDisplayName?.trim();
    recipient = trustedName
      ? trustedName
      : payload.externalRecipientPhone?.trim()
        ? externalSummaryDisplayName(payload.externalRecipientPhone.trim())
        : "—";
    recipientPhone = payload.externalRecipientPhone?.trim();
  } else {
    recipient = payload.recipientDisplayName ?? payload.recipientExternal?.name ?? "—";
    recipientPhone = payload.recipientExternal?.phone?.trim();
  }
  const recipientLine =
    recipientPhone && payload.actor === "external"
      ? `${recipient} (${recipientPhone})`
      : recipientPhone && payload.recipientPartyId == null && payload.recipientUserId == null
        ? `${recipient} (${recipientPhone})`
        : recipient;
  return (
    "Проверьте данные:\n" +
    `• Предмет: ${payload.item ?? "—"}\n` +
    `• Получатель: ${recipientLine}\n` +
    `• Комментарий: ${payload.comment?.trim() ? payload.comment : "—"}\n` +
    `• Срок: ${due}\n` +
    `${
      genericSummary ?
        `• Файлы: ${photoCount} (фото: ${attachmentStats.imageCount}, PDF: ${attachmentStats.pdfCount}${
          attachmentStats.otherCount > 0 ? `, прочие: ${attachmentStats.otherCount}` : ""
        })\n\n`
      : `• Фото: ${photoCount}\n\n`
    }` +
    "Нажмите «Создать передачу» ниже: данные сохранятся в трекере.\n" +
    "Получение посылки подтверждается отдельно кодом."
  );
}

async function photoCount(client: PoolClient, draftId: string): Promise<number> {
  const c = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draftId],
  );
  return c.rows[0]?.n ?? 0;
}

async function draftAttachmentStats(
  client: PoolClient,
  draftId: string,
): Promise<{ total: number; imageCount: number; pdfCount: number; otherCount: number }> {
  const c = await client.query<{ mime_type: string }>(
    `SELECT mime_type FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draftId],
  );
  let imageCount = 0;
  let pdfCount = 0;
  let otherCount = 0;
  for (const row of c.rows) {
    const mime = row.mime_type?.toLowerCase() ?? "";
    if (mime === "application/pdf") pdfCount += 1;
    else if (mime.startsWith("image/")) imageCount += 1;
    else otherCount += 1;
  }
  return { total: c.rows.length, imageCount, pdfCount, otherCount };
}

async function listDraftPhotoMeta(
  client: PoolClient,
  draftId: string,
): Promise<Array<{ sortOrder: number; fileName: string; mimeType: string }>> {
  const c = await client.query<{ sort_order: number; file_name: string; mime_type: string }>(
    `SELECT sort_order, file_name, mime_type FROM tt_external_request_draft_files WHERE draft_id = $1::uuid ORDER BY sort_order`,
    [draftId],
  );
  return c.rows.map((r) => ({ sortOrder: r.sort_order, fileName: r.file_name, mimeType: r.mime_type }));
}

function filteredRecipients(payload: NativeCreateDraftPayload): Array<{ userId: string; fullName: string }> {
  return payload.eligibleRecipients ?? [];
}

export async function renderDraftPrompt(
  client: PoolClient,
  channel: "telegram" | "max",
  draftId: string,
  step: string,
  payload: NativeCreateDraftPayload,
): Promise<NativeCreateReply> {
  const stats = await draftAttachmentStats(client, draftId);
  const count = stats.total;
  const text = stepPrompt(step, payload, stats);
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
      photoInspectButtons: photos.map((p) => {
        const transport = readNativeAttachmentTransportKind(payload, p.sortOrder, p.mimeType);
        const label =
          transport === "video" ? `Видео ${p.sortOrder + 1}`
          : transport === "file" || p.mimeType === "application/pdf" || p.mimeType === "application/octet-stream" ?
            `Файл ${p.sortOrder + 1}`
          : `Фото ${p.sortOrder + 1}`;
        return { label, arg: String(p.sortOrder) };
      }),
    });
  } else if (step === "recipient") {
    const page = payload.recipientPage ?? 0;
    const choices = payload.actor === "external" ? [] : filteredRecipients(payload);
    const slice = choices.slice(page * RECIPIENT_PAGE_SIZE, (page + 1) * RECIPIENT_PAGE_SIZE);
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "recipient", {
      recipientButtons: slice.map((c, i) => ({
        label: c.fullName.slice(0, 40),
        arg: String(page * RECIPIENT_PAGE_SIZE + i),
      })),
      pageNav: {
        hasPrev: page > 0,
        hasNext: (page + 1) * RECIPIENT_PAGE_SIZE < choices.length,
      },
    });
  } else if (
    step === "recipient_ext_name" &&
    payload.recipientExtAwaitNameConfirm &&
    (payload.recipientExternal?.phone || payload.externalRecipientPhone)
  ) {
    ui = buildStepUi(channel, draftId, payload.revision ?? 1, "recipient_ext_name_confirm");
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

async function myTransfersReply(client: PoolClient, ctx: NativeCreateContext): Promise<NativeCreateReply> {
  const { buildNativeMainMenuReply, nativeVerifiedContactRequiredReply } = await import("./main-menu");
  if (!ctx.isLinkedStaff && !ctx.personId) {
    return nativeVerifiedContactRequiredReply(
      ctx,
      "Подтвердите номер телефона, чтобы открыть передачи.",
    );
  }
  const menu = await buildNativeMainMenuReply(client, ctx, { lock: false });
  if (ctx.isLinkedStaff && ctx.staffUserId) {
    const origin = getAppOrigin() ?? "https://example.invalid";
    return {
      text: `Мои передачи в личном кабинете:\n${origin}/tan-tracker/`,
      replyMarkup: menu.replyMarkup,
      maxInlineButtons: menu.maxInlineButtons,
      telegramInlineKeyboard: undefined,
    };
  }
  const sessionRaw = await createPersonBrowserSession(client, ctx.personId!, ctx.channel);
  const origin = getAppOrigin() ?? "https://example.invalid";
  return {
    text: `Мои передачи:\n${origin}/tan-tracker/?est=${encodeURIComponent(sessionRaw)}`,
    replyMarkup: menu.replyMarkup,
    maxInlineButtons: menu.maxInlineButtons,
    telegramInlineKeyboard: undefined,
  };
}

async function startOrResumeCreate(client: PoolClient, ctx: NativeCreateContext): Promise<NativeCreateReply> {
  if (!ctx.privateDialogOk) {
    return navError("Создание передачи доступно только в личном чате с ботом.", ctx.channel);
  }
  const actor = ctx.isLinkedStaff ? "staff" : "external";
  if (actor === "external" && !ctx.personId) {
    const { nativeVerifiedContactRequiredReply } = await import("./main-menu");
    return nativeVerifiedContactRequiredReply(
      ctx,
      "Подтвердите номер телефона, чтобы создать передачу.",
    );
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
    case "recipient_ext_keep":
    case "recipient_ext_change":
      return step === "recipient_ext_name";
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
    case "menu_resume":
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
  if (payload.actor === "external") {
    payload.eligibleRecipients = [];
    payload.recipientPage = 0;
    payload.recipientSearchQuery = undefined;
  } else {
    payload.eligibleRecipients = [];
    payload.recipientPage = 0;
    payload.recipientSearchQuery = undefined;
  }
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
  if (payload.actor === "external") {
    return renderDraftPrompt(client, ctx.channel, id, step, payload);
  }
  const choices = filteredRecipients(payload);
  const pick = choices[idx];
  if (!pick) {
    const rendered = await renderDraftPrompt(client, ctx.channel, id, step, payload);
    return { ...rendered, text: `Получатель недоступен.\n\n${rendered.text}` };
  }
  if (payload.actor === "staff" && ctx.staffUserId) {
    const valid = await revalidateStaffRecipientPick(client, ctx.staffUserId, pick.userId);
    if (!valid) {
      const rendered = await renderDraftPrompt(client, ctx.channel, id, step, payload);
      return { ...rendered, text: `Получатель недоступен.\n\n${rendered.text}` };
    }
    const nextStep = payload.editReturnStep === "summary" ? "summary" : "due";
    clearExternalRecipientTarget(payload);
    const pendingUserId = userIdFromPendingUserPartyRef(pick.userId);
    let isExternalParty = false;
    if (!pendingUserId && isUuid(pick.userId)) {
      const partyRow = await client.query<{ kind: string }>(`SELECT kind FROM tt_parties WHERE id = $1::uuid`, [
        pick.userId,
      ]);
      isExternalParty = partyRow.rows[0]?.kind === "external";
    }
    const display =
      valid.fullName.replace(/\s*\(\+[^)]+\)\s*$/, "").trim() || valid.fullName;
    const nextPayload = await bumpDraftRevision(client, id, nextStep, {
      ...payload,
      recipientDisplayName: display,
      ...(isExternalParty
        ? {
            recipientPartyId: pick.userId,
            recipientUserId: undefined,
            recipientExternal: undefined,
          }
        : { recipientPartyId: pick.userId, recipientUserId: undefined }),
    });
    return renderDraftPrompt(client, ctx.channel, id, nextStep, nextPayload);
  }
  const nextStep = payload.editReturnStep === "summary" ? "summary" : "due";
  clearExternalRecipientTarget(payload);
  const nextPayload = await bumpDraftRevision(client, id, nextStep, {
    ...payload,
    recipientDisplayName: pick.fullName,
    recipientPartyId: pick.userId,
    recipientUserId: undefined,
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

  const { buildNativeMainMenuReply, nativeVerifiedContactRequiredReply } = await import("./main-menu");

  if (parsed.action === "menu") {
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Действие недоступно.";
      return buildNativeMainMenuReply(client, ctx, { prefix: message, lock: false });
    }
    return buildNativeMainMenuReply(client, ctx, { lock: false });
  }

  if (parsed.action === "menu_create" || parsed.action === "menu_my") {
    if (!isNativeMenuDraftHex(parsed.draftIdHex)) return null;
    if (parsed.action === "menu_create" && !ctx.isLinkedStaff && !ctx.personId) {
      return nativeVerifiedContactRequiredReply(
        ctx,
        "Подтвердите номер телефона, чтобы создать передачу.",
      );
    }
    if (parsed.action === "menu_my" && !ctx.isLinkedStaff && !ctx.personId) {
      return nativeVerifiedContactRequiredReply(
        ctx,
        "Подтвердите номер телефона, чтобы открыть передачи.",
      );
    }
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Действие недоступно.";
      return buildNativeMainMenuReply(client, ctx, { prefix: message, lock: false });
    }
    if (parsed.action === "menu_create") return startOrResumeCreate(client, ctx);
    return myTransfersReply(client, ctx);
  }

  if (parsed.action === "menu_resume") {
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Действие недоступно.";
      const { buildNativeMainMenuReply } = await import("./main-menu");
      return buildNativeMainMenuReply(client, ctx, { prefix: message, lock: false });
    }
    if (isNativeMenuDraftHex(parsed.draftIdHex)) return null;
    const actor = ctx.isLinkedStaff ? "staff" : "external";
    const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor);
    if (!draft || !draftIdMatchesHex(draft.id, parsed.draftIdHex)) {
      return navError("Черновик недоступен.", ctx.channel);
    }
    const payload = draft.payload as NativeCreateDraftPayload;
    assertDraftBoundToCaller(payload, ctx);
    assertDraftPersonRow(draft, ctx);
    return renderDraftPrompt(client, ctx.channel, draft.id, draft.step, payload);
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

  if (!callbackAllowedForStep(parsed.action, step)) {
    return renderDraftPrompt(client, ctx.channel, id, step, payload);
  }

  if (parsed.action === "cancel" || parsed.action === "restart") {
    await discardNativeBotDraft(client, id);
    if (parsed.action === "restart") return startOrResumeCreate(client, ctx);
    const { buildNativeMainMenuReply } = await import("./main-menu");
    return buildNativeMainMenuReply(client, ctx, { prefix: "Черновик отменён.", lock: false });
  }

  if (parsed.action === "back") {
    if (parsed.arg === "summary") {
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
    clearStaffRecipientTarget(payload);
    clearExternalRecipientTarget(payload);
    const nextPayload = await bumpDraftRevision(client, id, "recipient_ext_name", payload);
    return renderDraftPrompt(client, ctx.channel, id, "recipient_ext_name", nextPayload);
  }

  if (parsed.action === "recipient_ext_keep") {
    if (payload.actor === "external") {
      if (!payload.recipientExtAwaitNameConfirm || !payload.externalRecipientPhone) {
        return renderDraftPrompt(client, ctx.channel, id, step, payload);
      }
      const name =
        payload.recipientContactSuggestedName?.trim() ||
        payload.externalRecipientDisplayName?.trim() ||
        "";
      payload.externalRecipientDisplayName = name;
      delete payload.recipientDisplayName;
      delete payload.recipientExtAwaitNameConfirm;
      delete payload.recipientContactSuggestedName;
      payload.recipientNameManual = true;
      delete payload.recipientUserId;
      const nextPayload = await bumpDraftRevision(client, id, "due", payload);
      return renderDraftPrompt(client, ctx.channel, id, "due", nextPayload);
    }
    if (!payload.recipientExtAwaitNameConfirm || !payload.recipientExternal?.phone) {
      return renderDraftPrompt(client, ctx.channel, id, step, payload);
    }
    delete payload.recipientExtAwaitNameConfirm;
    delete payload.recipientContactSuggestedName;
    payload.recipientNameManual = false;
    stripTransientRecipientDraftFields(payload);
    payload.recipientDisplayName = payload.recipientExternal.name?.trim() || undefined;
    const nextPayload = await bumpDraftRevision(client, id, "recipient_ext_phone", payload);
    return renderDraftPrompt(client, ctx.channel, id, "recipient_ext_phone", nextPayload);
  }

  if (parsed.action === "recipient_ext_change") {
    if (!payload.recipientExtAwaitNameConfirm) {
      return renderDraftPrompt(client, ctx.channel, id, step, payload);
    }
    const phone = payload.recipientExternal?.phone ?? "";
    delete payload.recipientExtAwaitNameConfirm;
    payload.recipientNameManual = true;
    payload.recipientExternal = { name: "", phone };
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
    stripTransientRecipientDraftFields(payload);
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
        payload.eligibleRecipients = [];
        payload.recipientPage = 0;
        payload.recipientSearchQuery = undefined;
        clearStaffRecipientTarget(payload);
        clearExternalRecipientTarget(payload);
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
    const { nativeMediaQueueFromDraftAttachment } = await import("./reply-media");
    const transportKind = readNativeAttachmentTransportKind(payload, sortOrder, file.mime_type);
    const media = nativeMediaQueueFromDraftAttachment({
      channel: ctx.channel,
      draftId: id,
      sortOrder,
      fileName: file.file_name,
      transportKind,
      telegramFileId: file.telegram_file_id,
      maxFileToken: file.max_file_token,
    });
    if (!media) {
      return navError(
        "Вложение недоступно для предпросмотра в чате. Отправьте файл заново из MAX или Telegram.",
        ctx.channel,
      );
    }
    const ui = buildStepUi(ctx.channel, id, payload.revision ?? 1, "photo_inspect");
    const kindLabel =
      transportKind === "video" ? "Видео"
      : transportKind === "file" ? "Файл"
      : "Фото";
    return {
      text: `${kindLabel} ${sortOrder + 1}: ${file.file_name}`,
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
        const selectedRef = payload.recipientPartyId ?? payload.recipientUserId;
        if (selectedRef && !(await revalidateStaffRecipientPick(client, ctx.staffUserId, selectedRef))) {
          return navError("Получатель недоступен для этой передачи. Выберите другого получателя.", ctx.channel);
        }
        const created = await confirmNativeStaffDraft(client, {
          staffUserId: ctx.staffUserId,
          draftId: id,
          payload,
          channel: ctx.channel,
        });
        const { nativeCompletionMenuReply } = await import("./main-menu");
        return nativeCompletionMenuReply(client, ctx, created.resultText);
      }
      if (payload.actor === "external" && ctx.personId) {
        const party = await client.query<{ party_id: string }>(
          `SELECT party_id::text FROM tt_external_persons WHERE id = $1::uuid`,
          [ctx.personId],
        );
        const partyId = party.rows[0]?.party_id;
        if (!partyId) return { text: "Профиль недоступен.", requestContact: true };
        const phone = payload.externalRecipientPhone?.trim();
        if (!phone) {
          return navError("Укажите телефон получателя.", ctx.channel);
        }
        const staffUserId = await resolveExternalIntakeStaffUserId(client, partyId, phone);
        if (!staffUserId) {
          return navError(externalUnavailableMessage(), ctx.channel);
        }
        await bumpDraftRevision(client, id, "summary", {
          ...payload,
          recipientUserId: staffUserId,
        });
        const created = await confirmNativeExternalDraft(client, {
          personId: ctx.personId,
          externalPartyId: partyId,
          draftId: id,
        });
        const { nativeCompletionMenuReply } = await import("./main-menu");
        return nativeCompletionMenuReply(
          client,
          ctx,
          `Заявка отправлена: ${created.publicCode}. Сотрудник получит уведомление.`,
        );
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
  const {
    parseNativeBotSlashCommand,
    isNativeMainMenuText,
    isNativeContinueDraftText,
    isNativeCreateMenuText,
    buildNativeMainMenuReply,
  } = await import("./main-menu");

  const slash = parseNativeBotSlashCommand(trimmed);
  if (slash === "start" || slash === "menu") {
    return buildNativeMainMenuReply(client, ctx);
  }
  if (lower === "мои передачи" || slash === "my") {
    await lockNativeCreateMessenger(client, ctx);
    if (!ctx.isLinkedStaff && !ctx.personId) {
      const { nativeVerifiedContactRequiredReply } = await import("./main-menu");
      return nativeVerifiedContactRequiredReply(
        ctx,
        "Подтвердите номер телефона, чтобы открыть передачи.",
      );
    }
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Действие недоступно.";
      return buildNativeMainMenuReply(client, ctx, { prefix: message, lock: false });
    }
    return myTransfersReply(client, ctx);
  }

  if (isNativeMainMenuText(trimmed)) {
    return buildNativeMainMenuReply(client, ctx);
  }

  if (isNativeContinueDraftText(trimmed)) {
    await lockNativeCreateMessenger(client, ctx);
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Действие недоступно.";
      return buildNativeMainMenuReply(client, ctx, { prefix: message, lock: false });
    }
    const resumed = await resumeOwnedNativeDraft(client, ctx);
    if (resumed) return resumed;
    return buildNativeMainMenuReply(client, ctx, { prefix: "Нет черновика для продолжения.", lock: false });
  }

  if (slash === "new" || isNativeCreateMenuText(trimmed)) {
    await lockNativeCreateMessenger(client, ctx);
    if (!ctx.isLinkedStaff && !ctx.personId) {
      const { nativeVerifiedContactRequiredReply } = await import("./main-menu");
      return nativeVerifiedContactRequiredReply(
        ctx,
        "Подтвердите номер телефона, чтобы создать передачу.",
      );
    }
    try {
      await assertNativeCreateContext(client, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Создание недоступно.";
      return buildNativeMainMenuReply(client, ctx, { prefix: message, lock: false });
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
    clearStaffRecipientTarget(payload);
    const handled =
      payload.actor === "staff"
        ? await handleStaffRecipientSearchText(client, ctx, payload, trimmed)
        : await handleExternalRecipientPhoneText(client, ctx, payload, trimmed);
    const nextPayload = await bumpDraftRevision(client, draft.id, handled.step, handled.payload);
    const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, handled.step, nextPayload);
    if (handled.kind === "hint") {
      return { ...rendered, text: `${handled.message}\n\n${rendered.text}` };
    }
    return rendered;
  }

  if (step === "recipient_ext_name") {
    if (!trimmed) {
      return navError("Введите имя получателя.", ctx.channel);
    }
    if (payload.actor === "external") {
      payload.externalRecipientDisplayName = trimmed.slice(0, 120);
      delete payload.recipientDisplayName;
      payload.recipientNameManual = true;
      delete payload.recipientExtAwaitNameConfirm;
      delete payload.recipientContactSuggestedName;
      delete payload.recipientUserId;
      const nextPayload = await bumpDraftRevision(client, draft.id, "due", payload);
      return renderDraftPrompt(client, ctx.channel, draft.id, "due", nextPayload);
    }
    const phone = payload.recipientExternal?.phone ?? "";
    payload.recipientExternal = { name: trimmed.slice(0, 120), phone };
    payload.recipientNameManual = true;
    delete payload.recipientExtAwaitNameConfirm;
    delete payload.recipientContactSuggestedName;
    payload.recipientDisplayName = payload.recipientExternal.name;
    const nextPayload = await bumpDraftRevision(client, draft.id, "recipient_ext_phone", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "recipient_ext_phone", nextPayload);
  }

  if (step === "recipient_ext_phone") {
    const phone = normalizeRuPhoneE164(trimmed);
    if (!phone) return navError("Введите телефон: 10 цифр после +7.", ctx.channel);
    stripTransientRecipientDraftFields(payload);
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
  const { appendNativeCreateDraftPhoto, draftHasNonImageOnlyAttachments } = await import("./photo-store");
  let useGenericLabels = await draftHasNonImageOnlyAttachments(client, draft.id);
  const { formatNativeAttachmentStepFeedback, nativeAttachmentLimitMessage } = await import(
    "./attachment-feedback-text"
  );
  if (count >= 5) {
    const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, "photo", payload);
    const prefix = formatNativeAttachmentStepFeedback(
      { addedImages: 0, addedPdfs: 0, addedOther: 0 },
      count,
      [nativeAttachmentLimitMessage(useGenericLabels)],
      useGenericLabels,
    );
    return { ...rendered, text: `${prefix}\n\n${rendered.text}` };
  }
  const append = await appendNativeCreateDraftPhoto(client, {
    draftId: draft.id,
    sortOrder: count,
    buffer: input.buffer,
    mimeType: input.mimeType,
    fileName: input.fileName,
    telegramFileId: input.telegramFileId,
    maxFileToken: input.maxFileToken,
  });
  if (!append.ok) {
    const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, "photo", payload);
    const prefix = formatNativeAttachmentStepFeedback(
      { addedImages: 0, addedPdfs: 0, addedOther: 0 },
      count,
      [append.message],
      useGenericLabels,
    );
    return { ...rendered, text: `${prefix}\n\n${rendered.text}` };
  }
  recordNativeAttachmentTransportKind(payload, count, "image");
  const nextPayload = await bumpDraftRevision(client, draft.id, "photo", payload);
  const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, "photo", nextPayload);
  const storageMime = input.buffer.length ? (await import("./native-attachment-magic")).classifyNativeStorageMime(input.buffer) : input.mimeType;
  const added =
    storageMime === "application/pdf" ?
      { addedImages: 0, addedPdfs: 1, addedOther: 0 }
    : { addedImages: 1, addedPdfs: 0, addedOther: 0 };
  if (storageMime === "application/pdf") useGenericLabels = true;
  const prefix = formatNativeAttachmentStepFeedback(added, count + 1, [], useGenericLabels);
  return { ...rendered, text: `${prefix}\n\n${rendered.text}` };
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
    const rendered = await renderDraftPrompt(client, ctx.channel, draftId, step, payload);
    return {
      ...rendered,
      text: `В контакте несколько номеров. Отправьте контакт с одним номером (+7) или введите телефон вручную.\n\n${rendered.text}`,
    };
  }
  const phone = phones[0]!;
  clearStaffRecipientTarget(payload);
  delete payload.recipientPhonePickOptions;

  if (mode === "phone_only") {
    const preservedName = payload.recipientNameManual
      ? (payload.recipientExternal?.name ?? "")
      : (payload.recipientExternal?.name ?? "");
    payload.recipientExternal = {
      name: preservedName,
      phone,
    };
    delete payload.recipientExtAwaitNameConfirm;
    delete payload.recipientContactSuggestedName;
    payload.recipientDisplayName = payload.recipientExternal.name.trim() || undefined;
    const nextPayload = await bumpDraftRevision(client, draftId, "recipient_ext_phone", payload);
    return renderDraftPrompt(client, ctx.channel, draftId, "recipient_ext_phone", nextPayload);
  }

  const suggested = parsed.suggestedName?.trim() ?? "";
  payload.recipientExternal = { name: suggested, phone };
  payload.recipientContactSuggestedName = suggested;
  payload.recipientNameManual = false;
  payload.recipientDisplayName = suggested || undefined;

  if (suggested) {
    payload.recipientExtAwaitNameConfirm = true;
    const nextPayload = await bumpDraftRevision(client, draftId, "recipient_ext_name", payload);
    return renderDraftPrompt(client, ctx.channel, draftId, "recipient_ext_name", nextPayload);
  }

  delete payload.recipientExtAwaitNameConfirm;
  const nextPayload = await bumpDraftRevision(client, draftId, "recipient_ext_name", payload);
  return renderDraftPrompt(client, ctx.channel, draftId, "recipient_ext_name", nextPayload);
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
  if (!ctx.privateDialogOk) return null;
  if (input.isForwarded) return null;

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
  if (payload.actor !== actor) return null;

  const step = draft.step;
  if (step !== "recipient" && step !== "recipient_ext_name" && step !== "recipient_ext_phone") return null;

  const parsed =
    input.kind === "telegram"
      ? parseRecipientContactFromTelegram(input)
      : parseRecipientContactFromVcf(input.vcfInfo);
  if (!parsed.ok) {
    const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, step, payload);
    return { ...rendered, text: `${parsed.message}\n\n${rendered.text}` };
  }

  if (actor === "external") {
    if (step !== "recipient" || !ctx.personId) return null;
    const phones = parsed.data.phonesE164;
    if (phones.length !== 1) {
      const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, "recipient", payload);
      return {
        ...rendered,
        text: `В контакте несколько номеров. Отправьте контакт с одним номером (+7) или введите телефон вручную.\n\n${rendered.text}`,
      };
    }
    const phone = phones[0]!;
    const suggested = parsed.data.suggestedName?.trim() ?? "";
    payload.externalRecipientPhone = phone;
    delete payload.recipientUserId;
    payload.eligibleRecipients = [];
    payload.recipientContactSuggestedName = suggested || undefined;
    if (suggested) {
      payload.recipientExtAwaitNameConfirm = true;
      payload.externalRecipientDisplayName = suggested;
    } else {
      delete payload.recipientExtAwaitNameConfirm;
    }
    const nextPayload = await bumpDraftRevision(client, draft.id, "recipient_ext_name", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "recipient_ext_name", nextPayload);
  }

  if (step === "recipient" && actor === "staff" && ctx.staffUserId) {
    clearStaffRecipientTarget(payload);
    const pendingName = payload.recipientPendingExternalName?.trim();
    const phones = parsed.data.phonesE164;
    if (phones.length === 1) {
      const phone = phones[0]!;
      const hits = await searchStaffRecipientHits(client, ctx.staffUserId, phone);
      if (hits.length) {
        delete payload.recipientPendingExternalName;
        delete payload.recipientExternal;
        payload.recipientSearchQuery = phone;
        payload.eligibleRecipients = hitsToEligibleRecipients(hits);
        payload.recipientPage = 0;
        const nextPayload = await bumpDraftRevision(client, draft.id, "recipient", payload);
        return renderDraftPrompt(client, ctx.channel, draft.id, "recipient", nextPayload);
      }
      const existing = await findExistingExternalByPhone(client, ctx.staffUserId, phone);
      if (existing) {
        delete payload.recipientPendingExternalName;
        payload.recipientSearchQuery = phone;
        payload.eligibleRecipients = hitsToEligibleRecipients([
          { ref: existing.partyId, fullName: `${existing.name} (${existing.phone})`, phone: existing.phone },
        ]);
        payload.recipientPage = 0;
        const nextPayload = await bumpDraftRevision(client, draft.id, "recipient", payload);
        return renderDraftPrompt(client, ctx.channel, draft.id, "recipient", nextPayload);
      }
      if (pendingName) {
        payload.recipientExternal = { name: pendingName, phone: "" };
        payload.recipientNameManual = true;
        delete payload.recipientPendingExternalName;
      }
    }
    payload.recipientSearchQuery = undefined;
    payload.eligibleRecipients = [];
    payload.recipientPage = 0;
  }

  const pendingManual =
    Boolean(payload.recipientPendingExternalName?.trim()) ||
    (payload.recipientNameManual && Boolean(payload.recipientExternal?.name?.trim()));
  if (payload.recipientPendingExternalName?.trim() && !payload.recipientExternal?.name?.trim()) {
    payload.recipientExternal = {
      name: payload.recipientPendingExternalName.trim(),
      phone: payload.recipientExternal?.phone ?? "",
    };
    payload.recipientNameManual = true;
    delete payload.recipientPendingExternalName;
  }

  const contactMode =
    step === "recipient_ext_phone" ||
    (step === "recipient_ext_name" && pendingManual) ||
    (step === "recipient" && pendingManual)
      ? "phone_only"
      : "contact_first";

  return applyRecipientContactData(client, ctx, draft.id, step, payload, parsed.data, contactMode);
}
