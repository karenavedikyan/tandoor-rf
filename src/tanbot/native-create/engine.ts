import type { PoolClient } from "pg";
import { findPersonByMessenger } from "../../tan-tracker/external-person/person-service";
import { listEligibleStaffForExternalParty } from "../../tan-tracker/external-request/intake-handlers";
import { listTanTrackerRecipientCatalog } from "../../tan-tracker/recipient-catalog";
import { loadAccessContext } from "../../access/context";
import { assertPartyEligibleAsRecipient } from "../../tan-tracker/party-eligibility";
import { writeAttachmentBytes } from "../../tan-tracker/attachments";
import crypto from "crypto";
import {
  bumpDraftRevision,
  discardNativeBotDraft,
  ensureNativeBotDraft,
  loadNativeBotDraft,
  type NativeCreateDraftPayload,
} from "./draft-scope";
import { buildStepUi, menuReplyKeyboard } from "./keyboards";
import {
  draftIdMatchesShort,
  parseNativeCreateCallback,
  type ParsedNativeCreateCallback,
} from "./callback-codec";
import { confirmNativeExternalDraft, confirmNativeStaffDraft } from "./confirm-native";
import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";

export type NativeCreateReply = {
  text: string;
  requestContact?: boolean;
  replyMarkup?: Record<string, unknown>;
  telegramInlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
  maxInlineButtons?: import("../../tanbot-max/delivery-transport").MaxInlineButton[][];
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

const CREATE_TRIGGERS = new Set([
  "создать передачу",
  "отправить предмет",
  "/send",
  "/create",
  "/create@",
]);

export function isNativeCreateMenuText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (CREATE_TRIGGERS.has(t)) return true;
  return t.startsWith("/send") || t.startsWith("/create");
}

export function isNativeCreateCallback(data: string): boolean {
  return parseNativeCreateCallback(data) != null;
}

const RECIPIENT_PAGE = 6;

function stepPrompt(step: string, payload: NativeCreateDraftPayload, photoCount: number): string {
  switch (step) {
    case "item":
      return "Что передаёте? Кратко опишите предмет (до 500 символов).";
    case "photo":
      return photoCount > 0
        ? `Фото: ${photoCount}/5. Пришлите ещё или нажмите «Далее». «Пропустить» доступно только без фото.`
        : "Пришлите до 5 фото (по 8 МБ) или нажмите «Пропустить».";
    case "comment":
      return "Комментарий к передаче (или отправьте «—», чтобы пропустить).";
    case "recipient":
      return "Выберите получателя кнопкой ниже.";
    case "recipient_ext_name":
      return "Имя внешнего получателя (как в контакте).";
    case "recipient_ext_phone":
      return "Телефон получателя: 10 цифр после +7.";
    case "due":
      return "Выберите срок передачи.";
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
    payload.recipientExternal?.name ??
    payload.eligibleRecipients?.find((c) => c.userId === payload.recipientUserId)?.fullName ??
    payload.recipientPartyId ??
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
  if (step === "photo") ui = buildStepUi(channel, draftId, payload.revision ?? 1, "photo");
  if (step === "due") ui = buildStepUi(channel, draftId, payload.revision ?? 1, "due");
  if (step === "summary") ui = buildStepUi(channel, draftId, payload.revision ?? 1, "summary");
  if (step === "recipient") {
    const page = payload.recipientPage ?? 0;
    const choices = payload.eligibleRecipients ?? [];
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
    });
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
  for (const c of catalog.slice(0, 48)) {
    try {
      await assertPartyEligibleAsRecipient(client, access, ctx.staffUserId, c.id);
      out.push({ userId: c.id, fullName: c.name });
    } catch {
      /* skip ineligible */
    }
  }
  return out.map((c) => ({ userId: c.userId, fullName: c.fullName }));
}

async function startOrResumeCreate(client: PoolClient, ctx: NativeCreateContext): Promise<NativeCreateReply> {
  if (!ctx.privateDialogOk) {
    return { text: "Создание передачи доступно только в личном чате с ботом." };
  }
  const actor = ctx.isLinkedStaff ? "staff" : "external";
  if (actor === "external" && !ctx.personId) {
    return { text: "Подтвердите номер телефона, чтобы создать передачу.", requestContact: true };
  }
  if (actor === "staff" && !ctx.staffUserId) {
    return { text: "Профиль сотрудника недоступен." };
  }
  const draft = await ensureNativeBotDraft(client, {
    channel: ctx.channel,
    messengerChatId: ctx.messengerChatId,
    actor,
    personId: ctx.personId,
    staffUserId: ctx.staffUserId ?? undefined,
  });
  const payload = draft.payload as NativeCreateDraftPayload;
  return renderDraftPrompt(client, ctx.channel, draft.id, draft.step, payload);
}

async function resolveDraftForCallback(
  client: PoolClient,
  ctx: NativeCreateContext,
  parsed: ParsedNativeCreateCallback,
): Promise<{ id: string; step: string; payload: NativeCreateDraftPayload } | null> {
  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor);
  if (!draft) return null;
  if (!draftIdMatchesShort(draft.id, parsed.draftShortId)) return null;
  const payload = draft.payload as NativeCreateDraftPayload;
  if ((payload.revision ?? 0) !== parsed.revision) {
    return null;
  }
  return { id: draft.id, step: draft.step, payload };
}

export async function handleNativeCreateCallback(
  client: PoolClient,
  ctx: NativeCreateContext,
  callbackData: string,
): Promise<NativeCreateReply | null> {
  const parsed = parseNativeCreateCallback(callbackData);
  if (!parsed) return null;
  const draft = await resolveDraftForCallback(client, ctx, parsed);
  if (!draft && parsed.action !== "menu") {
    return { text: "Действие устарело. Нажмите «Создать передачу» снова.", replyMarkup: menuReplyKeyboard() };
  }

  if (parsed.action === "menu") {
    return { text: "Главное меню.", replyMarkup: menuReplyKeyboard() };
  }
  if (!draft) return null;

  const { id, step, payload } = draft;

  if (parsed.action === "cancel" || parsed.action === "restart") {
    await discardNativeBotDraft(client, id);
    if (parsed.action === "restart") return startOrResumeCreate(client, ctx);
    return { text: "Черновик отменён.", replyMarkup: menuReplyKeyboard() };
  }

  if (parsed.action === "back") {
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
                : "item";
    const nextPayload = await bumpDraftRevision(client, id, prev, payload);
    return renderDraftPrompt(client, ctx.channel, id, prev, nextPayload);
  }

  if (parsed.action === "photo_skip") {
    const count = await photoCount(client, id);
    if (count > 0) {
      return renderDraftPrompt(client, ctx.channel, id, step, payload);
    }
    const nextPayload = await bumpDraftRevision(client, id, "comment", payload);
    return renderDraftPrompt(client, ctx.channel, id, "comment", nextPayload);
  }

  if (parsed.action === "photo_next") {
    const nextPayload = await bumpDraftRevision(client, id, "comment", payload);
    return renderDraftPrompt(client, ctx.channel, id, "comment", nextPayload);
  }

  if (parsed.action === "due" && parsed.arg) {
    const mode = parsed.arg === "m" ? "tomorrow" : parsed.arg === "n" ? "none" : "today";
    const nextPayload = await bumpDraftRevision(client, id, "summary", { ...payload, dueMode: mode });
    return renderDraftPrompt(client, ctx.channel, id, "summary", nextPayload);
  }

  if (parsed.action === "recipient" && parsed.arg != null) {
    const idx = Number(parsed.arg);
    const choices = payload.eligibleRecipients ?? [];
    const pick = choices[idx];
    if (!pick) {
      return { text: "Получатель недоступен. Выберите из списка.", replyMarkup: menuReplyKeyboard() };
    }
    const nextPayload = await bumpDraftRevision(client, id, "due", {
      ...payload,
      ...(payload.actor === "external"
        ? { recipientUserId: pick.userId }
        : { recipientPartyId: pick.userId, recipientUserId: undefined }),
    });
    return renderDraftPrompt(client, ctx.channel, id, "due", nextPayload);
  }

  if (parsed.action === "recipient_page") {
    const page = payload.recipientPage ?? 0;
    const nextPage = parsed.arg === "n" ? page + 1 : Math.max(0, page - 1);
    const nextPayload = await bumpDraftRevision(client, id, step, { ...payload, recipientPage: nextPage });
    return renderDraftPrompt(client, ctx.channel, id, "recipient", nextPayload);
  }

  if (parsed.action === "edit") {
    const nextPayload = await bumpDraftRevision(client, id, "item", payload);
    return renderDraftPrompt(client, ctx.channel, id, "item", nextPayload);
  }

  if (parsed.action === "confirm") {
    if (step !== "summary") {
      return renderDraftPrompt(client, ctx.channel, id, step, payload);
    }
    try {
      if (payload.actor === "staff" && ctx.staffUserId) {
        const created = await confirmNativeStaffDraft(client, {
          staffUserId: ctx.staffUserId,
          draftId: id,
          payload,
        });
        return {
          text: `Передача создана: ${created.publicCode}. Получатель увидит её в личном кабинете или по приглашению.`,
          replyMarkup: menuReplyKeyboard(),
        };
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
      return { text: message, replyMarkup: menuReplyKeyboard() };
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
    return null;
  }

  if (isNativeCreateMenuText(trimmed)) {
    return startOrResumeCreate(client, ctx);
  }

  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor);
  if (!draft) return null;

  const payload = { ...(draft.payload as NativeCreateDraftPayload) };
  let step = draft.step;

  if (step === "item") {
    const item = trimmed.slice(0, 500);
    if (!item) return { text: "Укажите название предмета.", replyMarkup: menuReplyKeyboard() };
    payload.item = item;
    const nextPayload = await bumpDraftRevision(client, draft.id, "photo", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "photo", nextPayload);
  }

  if (step === "photo") {
    const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, step, payload);
    return { ...rendered, text: "На этом шаге отправьте фото или используйте кнопки «Далее» / «Пропустить»." };
  }

  if (step === "comment") {
    if (lower !== "—" && lower !== "-") payload.comment = trimmed.slice(0, 2000);
    else payload.comment = "";
    const choices = await loadRecipientChoices(client, ctx, payload);
    if (!choices.length) {
      return {
        text: "Нет доступных получателей. Обратитесь к менеджеру.",
        replyMarkup: menuReplyKeyboard(),
      };
    }
    payload.eligibleRecipients = choices;
    payload.recipientPage = 0;
    const nextPayload = await bumpDraftRevision(client, draft.id, "recipient", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "recipient", nextPayload);
  }

  if (step === "recipient_ext_name") {
    payload.recipientExternal = { name: trimmed.slice(0, 120), phone: payload.recipientExternal?.phone ?? "" };
    const nextPayload = await bumpDraftRevision(client, draft.id, "recipient_ext_phone", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "recipient_ext_phone", nextPayload);
  }

  if (step === "recipient_ext_phone") {
    const phone = normalizeRuPhoneE164(trimmed);
    if (!phone) return { text: "Введите телефон: 10 цифр после +7." };
    payload.recipientExternal = {
      name: payload.recipientExternal?.name ?? "",
      phone,
    };
    payload.recipientPartyId = undefined;
    payload.recipientUserId = undefined;
    const nextPayload = await bumpDraftRevision(client, draft.id, "due", payload);
    return renderDraftPrompt(client, ctx.channel, draft.id, "due", nextPayload);
  }

  return renderDraftPrompt(client, ctx.channel, draft.id, step, payload);
}

export async function handleNativeCreatePhoto(
  client: PoolClient,
  ctx: NativeCreateContext,
  input: { buffer: Buffer; mimeType: string; fileName: string },
): Promise<NativeCreateReply | null> {
  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor);
  if (!draft || draft.step !== "photo") return null;
  const count = await photoCount(client, draft.id);
  if (count >= 5) {
    return { text: "Не более 5 фото. Нажмите «Далее».", replyMarkup: menuReplyKeyboard() };
  }
  if (input.buffer.length > 8 * 1024 * 1024) {
    return { text: "Фото больше 8 МБ. Отправьте файл меньше.", replyMarkup: menuReplyKeyboard() };
  }
  const key = `native-draft/${draft.id}/${crypto.randomUUID()}-${input.fileName}`;
  await writeAttachmentBytes(client, key, input.buffer);
  await client.query(
    `INSERT INTO tt_external_request_draft_files (draft_id, storage_key, file_name, mime_type, byte_size, sort_order)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
    [draft.id, key, input.fileName, input.mimeType, input.buffer.length, count],
  );
  const payload = draft.payload as NativeCreateDraftPayload;
  return renderDraftPrompt(client, ctx.channel, draft.id, "photo", payload);
}
