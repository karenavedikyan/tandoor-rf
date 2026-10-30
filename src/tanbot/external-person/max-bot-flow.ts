import type { PoolClient } from "pg";
import { getAppOrigin } from "../../config";
import {
  createPersonBrowserSession,
  findPersonByMessenger,
  upsertVerifiedPerson,
} from "../../tan-tracker/external-person/person-service";
import { isExternalMessengerFeatureEnabled } from "../../tan-tracker/external-messenger/config";
import { findAccountByMaxUserId } from "../../tanbot-max/link-repository";
import { confirmExternalRequestDraft, type ExternalDraftPayload } from "../../tan-tracker/external-request/confirm";
import { listEligibleStaffForExternalParty } from "../../tan-tracker/external-request/intake-handlers";
import { writeAttachmentBytes } from "../../tan-tracker/attachments";
import crypto from "crypto";
import { fetchMaxImageBytes } from "../../tanbot-max/file-fetch";

export type ExternalPersonBotReply = {
  text: string;
  requestContact?: boolean;
  replyMarkup?: Record<string, unknown>;
};

const CHANNEL = "max" as const;

function menuKeyboard(): Record<string, unknown> {
  return {
    keyboard: [
      [{ text: "Мои передачи" }, { text: "Отправить предмет" }],
    ],
    resize_keyboard: true,
  };
}

async function lockDraft(client: PoolClient, chatId: bigint) {
  const row = await client.query<{ id: string; step: string; payload: ExternalDraftPayload; person_id: string | null }>(
    `SELECT id::text, step, payload, person_id::text FROM tt_external_request_drafts
     WHERE channel = $2 AND messenger_chat_id = $1 FOR UPDATE`,
    [chatId.toString(), CHANNEL],
  );
  return row.rows[0] ?? null;
}

async function ensureDraft(client: PoolClient, chatId: bigint, personId: string | null) {
  const existing = await lockDraft(client, chatId);
  if (existing) return existing;
  const ins = await client.query<{ id: string; step: string; payload: ExternalDraftPayload }>(
    `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
     VALUES ('max', $1, $2::uuid, 'item', '{}'::jsonb)
     ON CONFLICT (channel, messenger_chat_id) DO UPDATE SET updated_at = NOW()
     RETURNING id::text, step, payload`,
    [chatId.toString(), personId, CHANNEL],
  );
  return { ...ins.rows[0]!, person_id: personId };
}

export async function handleExternalPersonMaxContact(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    phoneRaw: string;
    firstName: string | null;
    contactUserId: number | null;
    isForwarded: boolean;
  },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  if (await findAccountByMaxUserId(client, input.maxUserId)) return null;
  if (input.isForwarded) {
    return { text: "Пересланные контакты не принимаются. Отправьте свой номер кнопкой.", requestContact: true };
  }
  if (input.contactUserId == null || BigInt(input.contactUserId) !== input.maxUserId) {
    return { text: "Нужен ваш собственный контакт из Max.", requestContact: true };
  }
  const person = await upsertVerifiedPerson(client, {
    channel: "max",
    messengerUserId: input.maxUserId,
    messengerChatId: input.chatId,
    phoneRaw: input.phoneRaw,
    displayName: input.firstName,
  });
  const sessionRaw = await createPersonBrowserSession(client, person.id, "max");
  const origin = getAppOrigin() ?? "https://example.invalid";
  const url = `${origin}/tan-tracker/?est=${encodeURIComponent(sessionRaw)}`;
  return {
    text: `Номер подтверждён. Откройте «Мои передачи»:\n${url}`,
    replyMarkup: menuKeyboard(),
  };
}

export async function handleExternalPersonMaxMessage(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    text: string;
    firstName: string | null;
  },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  if (await findAccountByMaxUserId(client, input.maxUserId)) return null;
  const text = input.text.trim();
  const lower = text.toLowerCase();
  const person = await findPersonByMessenger(client, "max", input.maxUserId);

  if (lower === "мои передачи" || lower.startsWith("/my")) {
    if (!person) {
      return {
        text: "Подтвердите свой номер телефона кнопкой ниже — так мы покажем только ваши передачи.",
        requestContact: true,
      };
    }
    const sessionRaw = await createPersonBrowserSession(client, person.id, "max");
    const origin = getAppOrigin() ?? "https://example.invalid";
    return {
      text: `Мои передачи:\n${origin}/tan-tracker/?est=${encodeURIComponent(sessionRaw)}`,
      replyMarkup: menuKeyboard(),
    };
  }

  if (lower === "отправить предмет" || lower.startsWith("/send")) {
    if (!person) {
      return { text: "Сначала подтвердите номер телефона.", requestContact: true };
    }
    await ensureDraft(client, input.chatId, person.id);
    return { text: "Шаг 1 из 6. Что передаёте? (кратко)", replyMarkup: menuKeyboard() };
  }

  const draft = await lockDraft(client, input.chatId);
  if (!draft) return null;
  if (!person && !draft.person_id) {
    return { text: "Подтвердите номер телефона перед продолжением.", requestContact: true };
  }
  const payload = { ...(draft.payload ?? {}) } as ExternalDraftPayload;
  let step = draft.step;
  if (step === "item") {
    payload.item = text.slice(0, 500);
    step = "photo";
    await client.query(
      `UPDATE tt_external_request_drafts SET step = $2, payload = $3::jsonb, person_id = COALESCE(person_id, $4::uuid), updated_at = NOW() WHERE id = $1::uuid`,
      [draft.id, step, JSON.stringify(payload), person?.id ?? draft.person_id],
    );
    return { text: "Шаг 2 из 6. Пришлите фото (до 5) или напишите «пропустить».", replyMarkup: menuKeyboard() };
  }
  if (step === "photo") {
    if (lower === "пропустить" || lower === "skip") {
      step = "comment";
      await client.query(
        `UPDATE tt_external_request_drafts SET step = $2, payload = $3::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
        [draft.id, step, JSON.stringify(payload)],
      );
      return { text: "Шаг 3 из 6. Комментарий (или «пропустить»).", replyMarkup: menuKeyboard() };
    }
    return { text: "Пришлите фото сообщением или напишите «пропустить».", replyMarkup: menuKeyboard() };
  }
  if (step === "comment") {
    if (lower !== "пропустить" && lower !== "skip") payload.comment = text.slice(0, 2000);
    step = "recipient";
    await client.query(
      `UPDATE tt_external_request_drafts SET step = $2, payload = $3::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      [draft.id, step, JSON.stringify(payload)],
    );
    const pid = person?.id ?? draft.person_id;
    const partyRow = pid
      ? await client.query<{ party_id: string }>(`SELECT party_id::text FROM tt_external_persons WHERE id = $1::uuid`, [pid])
      : { rows: [] as { party_id: string }[] };
    const eligible = partyRow.rows[0]?.party_id
      ? await listEligibleStaffForExternalParty(client, partyRow.rows[0].party_id)
      : [];
    if (!eligible.length) {
      return {
        text: "Шаг 4 из 6. Нет доступных сотрудников для заявки. Обратитесь к менеджеру или выберите получателя в веб-интерфейсе «Мои передачи».",
        replyMarkup: menuKeyboard(),
      };
    }
    const lines = eligible.slice(0, 8).map((e, i) => `${i + 1}. ${e.fullName}`);
    payload.recipientChoices = eligible.slice(0, 8).map((e) => e.userId);
    await client.query(
      `UPDATE tt_external_request_drafts SET step = $2, payload = $3::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      [draft.id, step, JSON.stringify(payload)],
    );
    return {
      text: `Шаг 4 из 6. Кому отправить заявку? Ответьте номером:\n${lines.join("\n")}`,
      replyMarkup: menuKeyboard(),
    };
  }
  if (step === "recipient") {
    const choices = payload.recipientChoices ?? [];
    const pick = Number.parseInt(text.trim(), 10);
    const byIndex = Number.isFinite(pick) && pick >= 1 && pick <= choices.length ? choices[pick - 1] : null;
    payload.recipientUserId = byIndex ?? text.trim();
    step = "due";
    await client.query(
      `UPDATE tt_external_request_drafts SET step = $2, payload = $3::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      [draft.id, step, JSON.stringify(payload)],
    );
    return { text: "Шаг 5 из 6. Срок: «сегодня» или «завтра».", replyMarkup: menuKeyboard() };
  }
  if (step === "due") {
    payload.dueMode = lower.includes("завт") ? "tomorrow" : "today";
    step = "summary";
    await client.query(
      `UPDATE tt_external_request_drafts SET step = $2, payload = $3::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      [draft.id, step, JSON.stringify(payload)],
    );
    return {
      text: `Шаг 6 из 6. Подтвердите:\n• ${payload.item}\n• срок: ${payload.dueMode === "tomorrow" ? "завтра" : "сегодня"}\nОтветьте «да» для отправки или «отмена».`,
      replyMarkup: menuKeyboard(),
    };
  }
  if (step === "summary") {
    if (lower === "отмена" || lower === "cancel") {
      await client.query(`DELETE FROM tt_external_request_drafts WHERE id = $1::uuid`, [draft.id]);
      return { text: "Заявка отменена.", replyMarkup: menuKeyboard() };
    }
    if (lower !== "да" && lower !== "yes") {
      return { text: "Ответьте «да» для отправки или «отмена».", replyMarkup: menuKeyboard() };
    }
    const pid = person?.id ?? draft.person_id;
    if (!pid) return { text: "Сессия недействительна.", requestContact: true };
    const personRow = await client.query<{ party_id: string }>(
      `SELECT party_id::text FROM tt_external_persons WHERE id = $1::uuid`,
      [pid],
    );
    const partyId = personRow.rows[0]?.party_id;
    if (!partyId) return { text: "Профиль недоступен.", requestContact: true };
    const idem = `ext-req:${draft.id}`;
    const created = await confirmExternalRequestDraft(client, {
      personId: pid,
      externalPartyId: partyId,
      draftId: draft.id,
      idempotencyKey: idem,
    });
    return {
      text: `Заявка отправлена. Номер передачи: ${created.publicCode}. Сотрудник получит уведомление.`,
      replyMarkup: menuKeyboard(),
    };
  }
  return null;
}

export async function handleExternalPersonMaxPhoto(
  client: PoolClient,
  input: { chatId: bigint; maxUserId: bigint; downloadUrl: string; fileName: string | null },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  if (await findAccountByMaxUserId(client, input.maxUserId)) return null;
  const draft = await lockDraft(client, input.chatId);
  if (!draft || draft.step !== "photo") return null;
  const count = await client.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
    [draft.id],
  );
  if ((count.rows[0]?.c ?? 0) >= 5) {
    return { text: "Не более 5 фото. Напишите «пропустить» или продолжите на следующем шаге." };
  }
  if (!input.downloadUrl?.trim()) {
    return { text: "Изображение принимается только с серверов MAX. Отправьте фото заново из чата." };
  }
  const bytes = await fetchMaxImageBytes(input.downloadUrl);
  if (!bytes.ok) return { text: bytes.message };
  const key = `external-draft/${draft.id}/${crypto.randomUUID()}-${input.fileName ?? "photo.jpg"}`;
  await writeAttachmentBytes(client, key, bytes.buffer);
  await client.query(
    `INSERT INTO tt_external_request_draft_files (draft_id, storage_key, file_name, mime_type, byte_size, max_file_token, sort_order)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
    [draft.id, key, input.fileName ?? "photo.jpg", bytes.mimeType, bytes.buffer.length, input.downloadUrl, count.rows[0]?.c ?? 0],
  );
  return { text: `Фото сохранено (${(count.rows[0]?.c ?? 0) + 1}/5). Ещё фото или «пропустить».`, replyMarkup: menuKeyboard() };
}
