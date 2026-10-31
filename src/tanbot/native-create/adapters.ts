import type { PoolClient } from "pg";
import { findAccountByTelegramUserId } from "../../tanbot-telegram/link-repository";
import { findAccountByMaxUserId } from "../../tanbot-max/link-repository";
import { findPersonByMessenger } from "../../tan-tracker/external-person/person-service";
import type { NativeCreateContext, NativeCreateReply } from "./engine";
import {
  handleNativeCreateCallback,
  handleNativeCreateMessage,
  handleNativeCreatePhoto,
  isNativeCreateCallback,
} from "./engine";

export { isNativeCreateCallback };

export async function buildTelegramNativeCreateContext(
  client: PoolClient,
  input: { chatId: bigint; telegramUserId: bigint; privateDialogOk?: boolean },
): Promise<NativeCreateContext> {
  const account = await findAccountByTelegramUserId(client, input.telegramUserId);
  const person = account ? null : await findPersonByMessenger(client, "telegram", input.telegramUserId);
  const privateDialogOk =
    input.privateDialogOk === true ||
    (input.privateDialogOk !== false && input.chatId === input.telegramUserId);
  return {
    channel: "telegram",
    messengerChatId: input.chatId.toString(),
    messengerUserId: input.telegramUserId,
    privateDialogOk,
    isLinkedStaff: !!account,
    staffUserId: account?.user_id ?? null,
    personId: person?.id ?? null,
  };
}

export async function buildMaxNativeCreateContext(
  client: PoolClient,
  input: { chatId: bigint; maxUserId: bigint; recipientChatType?: string | null },
): Promise<NativeCreateContext> {
  const account = await findAccountByMaxUserId(client, input.maxUserId);
  const person = account ? null : await findPersonByMessenger(client, "max", input.maxUserId);
  const privateDialogOk = input.recipientChatType === "dialog";
  return {
    channel: "max",
    messengerChatId: input.chatId.toString(),
    messengerUserId: input.maxUserId,
    privateDialogOk,
    isLinkedStaff: !!account,
    staffUserId: account?.user_id ?? null,
    personId: person?.id ?? null,
  };
}

export function nativeReplyToTelegram(reply: NativeCreateReply): {
  text: string;
  requestContact?: boolean;
  replyMarkup?: Record<string, unknown>;
  mediaFollowUp?: NativeCreateReply["mediaFollowUp"];
} {
  const markup =
    reply.telegramInlineKeyboard != null
      ? { inline_keyboard: reply.telegramInlineKeyboard }
      : reply.replyMarkup;
  return {
    text: reply.text,
    requestContact: reply.requestContact,
    replyMarkup: markup,
    mediaFollowUp: reply.mediaFollowUp,
  };
}

export function nativeReplyToMax(reply: NativeCreateReply): {
  text: string;
  requestContact?: boolean;
  replyMarkup?: Record<string, unknown>;
  inlineButtons?: NativeCreateReply["maxInlineButtons"];
  mediaFollowUp?: NativeCreateReply["mediaFollowUp"];
} {
  return {
    text: reply.text,
    requestContact: reply.requestContact,
    replyMarkup: reply.replyMarkup,
    inlineButtons: reply.maxInlineButtons,
    mediaFollowUp: reply.mediaFollowUp,
  };
}

export async function tryNativeCreateTelegramMessage(
  client: PoolClient,
  input: { chatId: bigint; telegramUserId: bigint; text: string; privateDialogOk?: boolean },
): Promise<ReturnType<typeof nativeReplyToTelegram> | null> {
  const ctx = await buildTelegramNativeCreateContext(client, input);
  const reply = await handleNativeCreateMessage(client, ctx, input.text);
  if (!reply) return null;
  return nativeReplyToTelegram(reply);
}

export async function tryNativeCreateTelegramCallback(
  client: PoolClient,
  input: { chatId: bigint; telegramUserId: bigint; data: string; privateDialogOk?: boolean },
): Promise<ReturnType<typeof nativeReplyToTelegram> | null> {
  const ctx = await buildTelegramNativeCreateContext(client, input);
  const reply = await handleNativeCreateCallback(client, ctx, input.data);
  if (!reply) return null;
  return nativeReplyToTelegram(reply);
}

export async function tryNativeCreateTelegramPhoto(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    privateDialogOk?: boolean;
  },
): Promise<ReturnType<typeof nativeReplyToTelegram> | null> {
  const ctx = await buildTelegramNativeCreateContext(client, input);
  const reply = await handleNativeCreatePhoto(client, ctx, input);
  if (!reply) return null;
  return nativeReplyToTelegram(reply);
}

export async function tryNativeCreateMaxMessage(
  client: PoolClient,
  input: { chatId: bigint; maxUserId: bigint; text: string; recipientChatType?: string | null },
): Promise<ReturnType<typeof nativeReplyToMax> | null> {
  const ctx = await buildMaxNativeCreateContext(client, input);
  const reply = await handleNativeCreateMessage(client, ctx, input.text);
  if (!reply) return null;
  return nativeReplyToMax(reply);
}

export async function tryNativeCreateMaxCallback(
  client: PoolClient,
  input: { chatId: bigint; maxUserId: bigint; payload: string; recipientChatType?: string | null },
): Promise<ReturnType<typeof nativeReplyToMax> | null> {
  const ctx = await buildMaxNativeCreateContext(client, input);
  const reply = await handleNativeCreateCallback(client, ctx, input.payload);
  if (!reply) return null;
  return nativeReplyToMax(reply);
}

export async function tryNativeCreateMaxPhoto(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    recipientChatType?: string | null;
  },
): Promise<ReturnType<typeof nativeReplyToMax> | null> {
  const ctx = await buildMaxNativeCreateContext(client, input);
  const reply = await handleNativeCreatePhoto(client, ctx, input);
  if (!reply) return null;
  return nativeReplyToMax(reply);
}
