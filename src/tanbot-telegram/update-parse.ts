const MAX_MESSAGE_TEXT_LEN = 4096;

export type ParsedPrivateMessageUpdate = {
  updateId: number;
  chatId: bigint;
  telegramUserId: bigint;
  username: string | null;
  firstName: string | null;
  text: string;
  startPayload: string | null;
};

export type ParsedCallbackUpdate = {
  updateId: number;
  chatId: bigint;
  telegramUserId: bigint;
  username: string | null;
  firstName: string | null;
  callbackQueryId: string;
  callbackData: string;
};

export type ParsedTelegramContactUpdate = {
  updateId: number;
  chatId: bigint;
  telegramUserId: bigint;
  contactUserId: number | null;
  phoneNumber: string;
  contactFirstName: string | null;
  contactLastName: string | null;
  vcard: string | null;
  isForwarded: boolean;
};

export type ParsedTelegramPhotoUpdate = {
  updateId: number;
  chatId: bigint;
  telegramUserId: bigint;
  fileId: string;
  fileName: string | null;
};

export type ParsedTelegramDocumentUpdate = {
  updateId: number;
  chatId: bigint;
  telegramUserId: bigint;
  fileId: string;
  fileName: string | null;
  mimeType: string | null;
};

export type ParsedTelegramVideoUpdate = {
  updateId: number;
  chatId: bigint;
  telegramUserId: bigint;
  fileId: string;
  fileName: string | null;
  mimeType: string | null;
};

export type ParsedTelegramWebhookUpdate =
  | { kind: "message"; update: ParsedPrivateMessageUpdate }
  | { kind: "contact"; update: ParsedTelegramContactUpdate }
  | { kind: "callback"; update: ParsedCallbackUpdate }
  | { kind: "photo"; update: ParsedTelegramPhotoUpdate }
  | { kind: "document"; update: ParsedTelegramDocumentUpdate }
  | { kind: "video"; update: ParsedTelegramVideoUpdate };

function parseMessageUpdate(row: Record<string, unknown>): ParsedTelegramWebhookUpdate | { ok: false; reason: string } {
  const updateId = row.update_id;
  if (typeof updateId !== "number" || !Number.isInteger(updateId) || updateId < 0) {
    return { ok: false, reason: "invalid_update_id" };
  }
  const message = row.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { ok: false, reason: "not_message" };
  }
  const msg = message as Record<string, unknown>;
  const chat = msg.chat;
  if (!chat || typeof chat !== "object") {
    return { ok: false, reason: "invalid_chat" };
  }
  const chatRow = chat as Record<string, unknown>;
  if (chatRow.type !== "private") {
    return { ok: false, reason: "non_private_chat" };
  }
  const chatId = chatRow.id;
  if (typeof chatId !== "number" || !Number.isInteger(chatId)) {
    return { ok: false, reason: "invalid_chat_id" };
  }
  const from = msg.from;
  if (!from || typeof from !== "object") {
    return { ok: false, reason: "invalid_from" };
  }
  const fromRow = from as Record<string, unknown>;
  const userId = fromRow.id;
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return { ok: false, reason: "invalid_user_id" };
  }
  if (fromRow.is_bot === true) {
    return { ok: false, reason: "bot_sender" };
  }
  if (BigInt(chatId) !== BigInt(userId)) {
    return { ok: false, reason: "private_chat_user_mismatch" };
  }
  const contact = msg.contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const c = contact as Record<string, unknown>;
    const phoneNumber = typeof c.phone_number === "string" ? c.phone_number : "";
    const contactUserId = typeof c.user_id === "number" ? c.user_id : null;
    const contactFirstName = typeof c.first_name === "string" ? c.first_name : null;
    const contactLastName = typeof c.last_name === "string" ? c.last_name : null;
    const vcard = typeof c.vcard === "string" ? c.vcard : null;
    if (!phoneNumber.trim()) return { ok: false, reason: "invalid_contact" };
    const isForwarded =
      msg.forward_origin != null ||
      msg.forward_date != null ||
      msg.forward_from != null ||
      msg.forward_from_chat != null ||
      (typeof msg.forward_sender_name === "string" && msg.forward_sender_name.length > 0);
    return {
      kind: "contact",
      update: {
        updateId,
        chatId: BigInt(chatId),
        telegramUserId: BigInt(userId),
        contactUserId,
        phoneNumber,
        contactFirstName,
        contactLastName,
        vcard,
        isForwarded: Boolean(isForwarded),
      },
    };
  }

  const photos = msg.photo;
  if (Array.isArray(photos) && photos.length > 0) {
    const largest = photos[photos.length - 1] as Record<string, unknown>;
    const fileId = typeof largest.file_id === "string" ? largest.file_id : "";
    const fileUniqueId = typeof largest.file_unique_id === "string" ? largest.file_unique_id : "photo";
    if (fileId) {
      return {
        kind: "photo",
        update: {
          updateId,
          chatId: BigInt(chatId),
          telegramUserId: BigInt(userId),
          fileId,
          fileName: `${fileUniqueId}.jpg`,
        },
      };
    }
  }

  const video = msg.video;
  if (video && typeof video === "object" && !Array.isArray(video)) {
    const vid = video as Record<string, unknown>;
    const fileId = typeof vid.file_id === "string" ? vid.file_id : "";
    const fileName = typeof vid.file_name === "string" ? vid.file_name : null;
    const mimeType = typeof vid.mime_type === "string" ? vid.mime_type : "video/mp4";
    if (fileId) {
      return {
        kind: "video",
        update: {
          updateId,
          chatId: BigInt(chatId),
          telegramUserId: BigInt(userId),
          fileId,
          fileName,
          mimeType,
        },
      };
    }
  }

  const document = msg.document;
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const doc = document as Record<string, unknown>;
    const fileId = typeof doc.file_id === "string" ? doc.file_id : "";
    const fileName = typeof doc.file_name === "string" ? doc.file_name : null;
    const mimeType = typeof doc.mime_type === "string" ? doc.mime_type : null;
    if (fileId) {
      return {
        kind: "document",
        update: {
          updateId,
          chatId: BigInt(chatId),
          telegramUserId: BigInt(userId),
          fileId,
          fileName,
          mimeType,
        },
      };
    }
  }

  const textRaw = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : undefined;
  if (typeof textRaw !== "string") {
    return { ok: false, reason: "no_text" };
  }
  const text = textRaw.trim().slice(0, MAX_MESSAGE_TEXT_LEN);
  if (!text.length) {
    return { ok: false, reason: "empty_text" };
  }

  let startPayload: string | null = null;
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    if (parts.length > 1 && parts[1]) {
      startPayload = parts[1].trim().slice(0, 64);
    }
  }

  const username =
    typeof fromRow.username === "string" && fromRow.username.trim()
      ? fromRow.username.replace(/^@+/, "").slice(0, 32)
      : null;
  const firstName =
    typeof fromRow.first_name === "string" ? fromRow.first_name.trim().slice(0, 128) : null;

  return {
    kind: "message",
    update: {
      updateId,
      chatId: BigInt(chatId),
      telegramUserId: BigInt(userId),
      username,
      firstName,
      text,
      startPayload,
    },
  };
}

function parseCallbackUpdate(row: Record<string, unknown>): ParsedTelegramWebhookUpdate | { ok: false; reason: string } {
  const updateId = row.update_id;
  if (typeof updateId !== "number" || !Number.isInteger(updateId) || updateId < 0) {
    return { ok: false, reason: "invalid_update_id" };
  }
  const cq = row.callback_query;
  if (!cq || typeof cq !== "object" || Array.isArray(cq)) {
    return { ok: false, reason: "not_callback" };
  }
  const callback = cq as Record<string, unknown>;
  const callbackQueryId = callback.id;
  if (typeof callbackQueryId !== "string" && typeof callbackQueryId !== "number") {
    return { ok: false, reason: "invalid_callback_id" };
  }
  const data = callback.data;
  if (typeof data !== "string" || !data.trim() || Buffer.byteLength(data, "utf8") > 64) {
    return { ok: false, reason: "invalid_callback_data" };
  }
  const from = callback.from;
  if (!from || typeof from !== "object") return { ok: false, reason: "invalid_from" };
  const fromRow = from as Record<string, unknown>;
  const userId = fromRow.id;
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0) {
    return { ok: false, reason: "invalid_user_id" };
  }
  if (fromRow.is_bot === true) return { ok: false, reason: "bot_sender" };

  const message = callback.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { ok: false, reason: "missing_private_chat" };
  }
  const chat = (message as Record<string, unknown>).chat;
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) {
    return { ok: false, reason: "missing_private_chat" };
  }
  const chatRow = chat as Record<string, unknown>;
  if (chatRow.type !== "private") return { ok: false, reason: "not_private_chat" };
  if (chatRow.id !== userId) {
    return { ok: false, reason: "private_chat_identity_mismatch" };
  }

  const username =
    typeof fromRow.username === "string" && fromRow.username.trim()
      ? fromRow.username.replace(/^@+/, "").slice(0, 32)
      : null;
  const firstName =
    typeof fromRow.first_name === "string" ? fromRow.first_name.trim().slice(0, 128) : null;

  return {
    kind: "callback",
    update: {
      updateId,
      chatId: BigInt(userId),
      telegramUserId: BigInt(userId),
      username,
      firstName,
      callbackQueryId: String(callbackQueryId),
      callbackData: data.trim(),
    },
  };
}

export function parseTelegramWebhookUpdate(raw: unknown):
  | { ok: true; parsed: ParsedTelegramWebhookUpdate }
  | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const row = raw as Record<string, unknown>;
  if (row.callback_query) {
    const parsed = parseCallbackUpdate(row);
    if ("ok" in parsed && parsed.ok === false) return parsed;
    return { ok: true, parsed: parsed as ParsedTelegramWebhookUpdate };
  }
  const parsed = parseMessageUpdate(row);
  if ("ok" in parsed && parsed.ok === false) return parsed;
  return { ok: true, parsed: parsed as ParsedTelegramWebhookUpdate };
}

/** @deprecated use parseTelegramWebhookUpdate — kept for legacy tests expecting message-only shape */
export function parseTelegramWebhookMessage(raw: unknown):
  | { ok: true; update: ParsedPrivateMessageUpdate }
  | { ok: false; reason: string } {
  const parsed = parseTelegramWebhookUpdate(raw);
  if (!parsed.ok) return parsed;
  if (parsed.parsed.kind !== "message") {
    return { ok: false, reason: "not_message" };
  }
  return { ok: true, update: parsed.parsed.update };
}
