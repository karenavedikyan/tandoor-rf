import { MAX_START_PAYLOAD_MAX_LEN } from "./stage2-config";
import { computeMaxUpdateDedupKey } from "./update-dedup-key";
import { parseMaxContactFromMessage } from "../tanbot/external-recipient/max-contact-verify";

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
  callbackPayload: string | null;
};

export type ParsedMaxContactWebhookUpdate = {
  dedupKey: string;
  updateType: string;
  chatId: bigint;
  maxUserId: bigint;
  contact: NonNullable<ReturnType<typeof parseMaxContactFromMessage>>;
  isForwarded: boolean;
};

function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.replace(/^@+/, "").slice(0, 64);
}

function readUserIdFromRow(row: Record<string, unknown>): number | null {
  const top = row.user_id;
  if (typeof top === "number" && Number.isInteger(top) && top > 0) return top;
  const user = row.user;
  if (user && typeof user === "object" && !Array.isArray(user)) {
    const uid = (user as Record<string, unknown>).user_id;
    if (typeof uid === "number" && Number.isInteger(uid) && uid > 0) return uid;
  }
  return null;
}

export type ParsedMaxWebhookUpdateUnion = ParsedMaxWebhookUpdate | ParsedMaxContactWebhookUpdate;

export function parseMaxWebhookUpdate(raw: unknown):
  | { ok: true; update: ParsedMaxWebhookUpdateUnion }
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

  if (updateType === "message_callback") {
    const callback = row.callback;
    if (!callback || typeof callback !== "object" || Array.isArray(callback)) {
      return { ok: false, reason: "invalid_callback" };
    }
    const cb = callback as Record<string, unknown>;
    const payload = typeof cb.payload === "string" ? cb.payload.trim().slice(0, 256) : null;
    const callbackId = typeof cb.callback_id === "string" ? cb.callback_id : String(timestamp);
    const user = cb.user;
    if (!user || typeof user !== "object") return { ok: false, reason: "invalid_user" };
    const userRow = user as Record<string, unknown>;
    const userId = userRow.user_id;
    if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
      return { ok: false, reason: "invalid_user_id" };
    }
    if (userRow.is_bot === true) return { ok: false, reason: "bot_sender" };
    let chatId = 0;
    const message = row.message;
    if (message && typeof message === "object" && !Array.isArray(message)) {
      const recipient = (message as Record<string, unknown>).recipient;
      if (recipient && typeof recipient === "object") {
        const cid = (recipient as Record<string, unknown>).chat_id;
        if (typeof cid === "number" && Number.isInteger(cid)) chatId = cid;
      }
    }
    if (!chatId) chatId = userId;
    const dedupKey = computeMaxUpdateDedupKey({
      updateType,
      timestamp,
      chatId,
      userId,
      messageMid: callbackId,
    });
    return {
      ok: true,
      update: {
        dedupKey,
        updateType,
        chatId: BigInt(chatId),
        maxUserId: BigInt(userId),
        username: normalizeUsername(userRow.username),
        firstName:
          typeof userRow.first_name === "string" ? userRow.first_name.trim().slice(0, 128) : null,
        startPayload: null,
        commandText: null,
        callbackPayload: payload,
      },
    };
  }

  if (updateType === "bot_started") {
    const chatIdRaw = row.chat_id;
    if (typeof chatIdRaw !== "number" || !Number.isInteger(chatIdRaw)) {
      return { ok: false, reason: "invalid_chat_id" };
    }
    const userId = readUserIdFromRow(row);
    if (!userId) return { ok: false, reason: "invalid_user_id" };
    const user = row.user as Record<string, unknown> | undefined;
    if (user?.is_bot === true) return { ok: false, reason: "bot_sender" };
    let startPayload: string | null = null;
    if (typeof row.payload === "string" && row.payload.trim()) {
      startPayload = row.payload.trim().slice(0, MAX_START_PAYLOAD_MAX_LEN);
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
        username: user ? normalizeUsername(user.username) : null,
        firstName:
          user && typeof user.first_name === "string" ? user.first_name.trim().slice(0, 128) : null,
        startPayload,
        commandText: null,
        callbackPayload: null,
      },
    };
  }

  if (updateType === "bot_stopped") {
    const userId = readUserIdFromRow(row);
    if (!userId) return { ok: false, reason: "invalid_user_id" };
    const chatIdRaw = typeof row.chat_id === "number" && Number.isInteger(row.chat_id) ? row.chat_id : userId;
    const dedupKey = computeMaxUpdateDedupKey({
      updateType,
      timestamp,
      chatId: chatIdRaw,
      userId,
    });
    const user = row.user as Record<string, unknown> | undefined;
    return {
      ok: true,
      update: {
        dedupKey,
        updateType,
        chatId: BigInt(chatIdRaw),
        maxUserId: BigInt(userId),
        username: user ? normalizeUsername(user.username) : null,
        firstName: null,
        startPayload: null,
        commandText: "/stop",
        callbackPayload: null,
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

    let chatId = 0;
    const recipient = msg.recipient;
    if (recipient && typeof recipient === "object") {
      const cid = (recipient as Record<string, unknown>).chat_id;
      if (typeof cid === "number" && Number.isInteger(cid)) chatId = cid;
    }
    if (!chatId && typeof row.chat_id === "number") chatId = row.chat_id;
    if (!chatId) chatId = userId;

    const contact = parseMaxContactFromMessage(msg);
    if (contact) {
      let mid: string | null = null;
      const body = msg.body;
      if (typeof body === "object" && body && !Array.isArray(body)) {
        const bodyMid = (body as Record<string, unknown>).mid;
        if (typeof bodyMid === "string") mid = bodyMid;
      }
      if (!mid && typeof msg.mid === "string") mid = msg.mid;
      const isForwarded =
        msg.link != null ||
        (typeof body === "object" &&
          body &&
          !Array.isArray(body) &&
          (body as Record<string, unknown>).link != null);
      const dedupKey = computeMaxUpdateDedupKey({
        updateType,
        timestamp,
        chatId,
        userId,
        messageMid: mid,
      });
      return {
        ok: true,
        update: {
          dedupKey,
          updateType,
          chatId: BigInt(chatId),
          maxUserId: BigInt(userId),
          contact,
          isForwarded: Boolean(isForwarded),
        },
      };
    }

    const body = msg.body;
    const textRaw =
      typeof body === "object" && body && !Array.isArray(body)
        ? (body as Record<string, unknown>).text
        : msg.text;
    if (typeof textRaw !== "string") return { ok: false, reason: "no_text" };
    const text = textRaw.trim().slice(0, MAX_MESSAGE_TEXT_LEN);
    if (!text.length) return { ok: false, reason: "empty_text" };

    let mid: string | null = null;
    if (typeof body === "object" && body && !Array.isArray(body)) {
      const bodyMid = (body as Record<string, unknown>).mid;
      if (typeof bodyMid === "string") mid = bodyMid;
    }
    if (!mid && typeof msg.mid === "string") mid = msg.mid;

    const dedupKey = computeMaxUpdateDedupKey({
      updateType,
      timestamp,
      chatId,
      userId,
      messageMid: mid,
    });
    return {
      ok: true,
      update: {
        dedupKey,
        updateType,
        chatId: BigInt(chatId),
        maxUserId: BigInt(userId),
        username: normalizeUsername(senderRow.username),
        firstName:
          typeof senderRow.first_name === "string" ? senderRow.first_name.trim().slice(0, 128) : null,
        startPayload: null,
        commandText: text,
        callbackPayload: null,
      },
    };
  }

  return { ok: false, reason: "unsupported_update_type" };
}
