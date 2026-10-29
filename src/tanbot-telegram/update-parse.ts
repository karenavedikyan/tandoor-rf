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

export function parseTelegramWebhookUpdate(raw: unknown):
  | { ok: true; update: ParsedPrivateMessageUpdate }
  | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const row = raw as Record<string, unknown>;
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
    ok: true,
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
