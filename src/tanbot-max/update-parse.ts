import { MAX_START_PAYLOAD_MAX_LEN } from "./stage2-config";
import { computeMaxUpdateDedupKey } from "./update-dedup-key";

const MAX_MESSAGE_TEXT_LEN = 4096;

export type ParsedMaxWebhookUpdate = {
  dedupKey: string;
  updateType: string;
  chatId: bigint;
  maxUserId: bigint;
  username: string | null;
  firstName: string | null;
  startPayload: string | null;
  commandText: string | null;
};

export function parseMaxWebhookUpdate(raw: unknown):
  | { ok: true; update: ParsedMaxWebhookUpdate }
  | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const row = raw as Record<string, unknown>;
  const updateType = row.update_type;
  if (typeof updateType !== "string" || !updateType.trim()) {
    return { ok: false, reason: "invalid_update_type" };
  }

  const timestamp = row.timestamp;
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp) || timestamp < 0) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const chatIdRaw = row.chat_id;
  if (typeof chatIdRaw !== "number" || !Number.isInteger(chatIdRaw)) {
    return { ok: false, reason: "invalid_chat_id" };
  }

  if (updateType === "bot_started") {
    const user = row.user;
    if (!user || typeof user !== "object" || Array.isArray(user)) {
      return { ok: false, reason: "invalid_user" };
    }
    const userRow = user as Record<string, unknown>;
    const userId = userRow.user_id;
    if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
      return { ok: false, reason: "invalid_user_id" };
    }
    if (userRow.is_bot === true) {
      return { ok: false, reason: "bot_sender" };
    }
    let startPayload: string | null = null;
    if (typeof row.payload === "string" && row.payload.trim()) {
      startPayload = row.payload.trim().slice(0, MAX_START_PAYLOAD_MAX_LEN);
    }
    const username = normalizeUsername(userRow.username);
    const firstName =
      typeof userRow.first_name === "string" ? userRow.first_name.trim().slice(0, 128) : null;
    const dedupKey = computeMaxUpdateDedupKey({
      updateType,
      timestamp,
      chatId: chatIdRaw,
      userId,
    });
    return {
      ok: true,
      update: {
        dedupKey,
        updateType,
        chatId: BigInt(chatIdRaw),
        maxUserId: BigInt(userId),
        username,
        firstName,
        startPayload,
        commandText: null,
      },
    };
  }

  if (updateType === "bot_stopped") {
    const user = row.user;
    if (!user || typeof user !== "object") return { ok: false, reason: "invalid_user" };
    const userRow = user as Record<string, unknown>;
    const userId = userRow.user_id;
    if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
      return { ok: false, reason: "invalid_user_id" };
    }
    const dedupKey = computeMaxUpdateDedupKey({
      updateType,
      timestamp,
      chatId: chatIdRaw,
      userId,
    });
    return {
      ok: true,
      update: {
        dedupKey,
        updateType,
        chatId: BigInt(chatIdRaw),
        maxUserId: BigInt(userId),
        username: normalizeUsername(userRow.username),
        firstName: null,
        startPayload: null,
        commandText: "/stop",
      },
    };
  }

  if (updateType === "message_created") {
    const message = row.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { ok: false, reason: "not_message" };
    }
    const msg = message as Record<string, unknown>;
    const sender = msg.sender;
    if (!sender || typeof sender !== "object") return { ok: false, reason: "invalid_sender" };
    const senderRow = sender as Record<string, unknown>;
    const userId = senderRow.user_id;
    if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
      return { ok: false, reason: "invalid_user_id" };
    }
    if (senderRow.is_bot === true) return { ok: false, reason: "bot_sender" };
    const body = msg.body;
    const textRaw =
      typeof body === "object" && body && !Array.isArray(body)
        ? (body as Record<string, unknown>).text
        : msg.text;
    if (typeof textRaw !== "string") return { ok: false, reason: "no_text" };
    const text = textRaw.trim().slice(0, MAX_MESSAGE_TEXT_LEN);
    if (!text.length) return { ok: false, reason: "empty_text" };
    const mid =
      typeof msg.mid === "string"
        ? msg.mid
        : typeof msg.message_id === "string"
          ? msg.message_id
          : null;
    const dedupKey = computeMaxUpdateDedupKey({
      updateType,
      timestamp,
      chatId: chatIdRaw,
      userId,
      messageMid: mid,
    });
    return {
      ok: true,
      update: {
        dedupKey,
        updateType,
        chatId: BigInt(chatIdRaw),
        maxUserId: BigInt(userId),
        username: normalizeUsername(senderRow.username),
        firstName:
          typeof senderRow.first_name === "string" ? senderRow.first_name.trim().slice(0, 128) : null,
        startPayload: null,
        commandText: text,
      },
    };
  }

  return { ok: false, reason: "unsupported_update_type" };
}

function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.replace(/^@+/, "").slice(0, 64);
}
