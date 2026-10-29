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

export type ParsedTelegramWebhookUpdate =
  | { kind: "message"; update: ParsedPrivateMessageUpdate }
  | { kind: "callback"; update: ParsedCallbackUpdate };

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
  const textRaw = msg.text;
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
  if (typeof data !== "string" || !data.trim()) {
    return { ok: false, reason: "invalid_callback_data" };
  }
  const from = callback.from;
  if (!from || typeof from !== "object") return { ok: false, reason: "invalid_from" };
  const fromRow = from as Record<string, unknown>;
  const userId = fromRow.id;
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return { ok: false, reason: "invalid_user_id" };
  }
  if (fromRow.is_bot === true) return { ok: false, reason: "bot_sender" };

  let chatId: number | null = null;
  const message = callback.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const chat = (message as Record<string, unknown>).chat;
    if (chat && typeof chat === "object") {
      const cid = (chat as Record<string, unknown>).id;
      if (typeof cid === "number" && Number.isInteger(cid)) chatId = cid;
    }
  }
  if (chatId === null) chatId = userId;

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
      chatId: BigInt(chatId),
      telegramUserId: BigInt(userId),
      username,
      firstName,
      callbackQueryId: String(callbackQueryId),
      callbackData: data.trim().slice(0, 64),
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
