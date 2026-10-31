import type { PoolClient } from "pg";
import { getAppOrigin } from "../../config";
import {
  createPersonBrowserSession,
  findPersonByMessenger,
  upsertVerifiedPerson,
} from "../../tan-tracker/external-person/person-service";
import { isExternalMessengerFeatureEnabled } from "../../tan-tracker/external-messenger/config";
import { findAccountByTelegramUserId } from "../../tanbot-telegram/link-repository";
import { menuReplyKeyboard } from "../native-create/keyboards";
import { tryNativeCreateTelegramMessage, tryNativeCreateTelegramPhoto } from "../native-create/adapters";

export type ExternalPersonBotReply = {
  text: string;
  requestContact?: boolean;
  replyMarkup?: Record<string, unknown>;
};

export async function handleExternalPersonTelegramContact(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    phoneRaw: string;
    firstName: string | null;
    contactUserId: number | null;
    isForwarded: boolean;
  },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  if (await findAccountByTelegramUserId(client, input.telegramUserId)) return null;
  if (input.isForwarded) {
    return { text: "Пересланные контакты не принимаются. Отправьте свой номер кнопкой.", requestContact: true };
  }
  if (input.contactUserId == null || BigInt(input.contactUserId) !== input.telegramUserId) {
    return { text: "Нужен ваш собственный контакт из Telegram.", requestContact: true };
  }
  const person = await upsertVerifiedPerson(client, {
    channel: "telegram",
    messengerUserId: input.telegramUserId,
    messengerChatId: input.chatId,
    phoneRaw: input.phoneRaw,
    displayName: input.firstName,
  });
  const sessionRaw = await createPersonBrowserSession(client, person.id, "telegram");
  const origin = getAppOrigin() ?? "https://example.invalid";
  const url = `${origin}/tan-tracker/?est=${encodeURIComponent(sessionRaw)}`;
  return {
    text: `Номер подтверждён. Откройте «Мои передачи» или «Оформить передачу» в меню:\n${url}`,
    replyMarkup: menuReplyKeyboard(),
  };
}

export async function handleExternalPersonTelegramMessage(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    text: string;
    firstName: string | null;
  },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  if (await findAccountByTelegramUserId(client, input.telegramUserId)) return null;
  const text = input.text.trim();
  const lower = text.toLowerCase();
  const person = await findPersonByMessenger(client, "telegram", input.telegramUserId);

  const { parseNativeBotSlashCommand } = await import("../native-create/main-menu");
  if (lower === "мои передачи" || parseNativeBotSlashCommand(text) === "my") {
    const native = await tryNativeCreateTelegramMessage(client, input);
    if (native) return native;
    if (!person) {
      return {
        text: "Подтвердите свой номер телефона кнопкой ниже — так мы покажем только ваши передачи.",
        requestContact: true,
      };
    }
    const sessionRaw = await createPersonBrowserSession(client, person.id, "telegram");
    const origin = getAppOrigin() ?? "https://example.invalid";
    return {
      text: `Мои передачи:\n${origin}/tan-tracker/?est=${encodeURIComponent(sessionRaw)}`,
      replyMarkup: menuReplyKeyboard(),
    };
  }

  return tryNativeCreateTelegramMessage(client, input);
}

export async function handleExternalPersonTelegramPhoto(
  client: PoolClient,
  input: { chatId: bigint; telegramUserId: bigint; fileId: string; fileName: string | null },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  const { ingestNativeCreateTelegramAttachments } = await import("../native-create/photo-ingest");
  const { nativeReplyToTelegram } = await import("../native-create/adapters");
  const native = await ingestNativeCreateTelegramAttachments(client, {
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    attachments: [
      {
        kind: "image",
        downloadUrl: "",
        fileName: input.fileName ?? "photo.jpg",
        telegramFileId: input.fileId,
      },
    ],
  });
  if (!native) return null;
  return nativeReplyToTelegram(native);
}

export async function handleExternalPersonTelegramDocument(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    fileId: string;
    fileName: string | null;
    mimeType: string | null;
  },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  const { ingestNativeCreateTelegramAttachments } = await import("../native-create/photo-ingest");
  const { nativeReplyToTelegram } = await import("../native-create/adapters");
  const native = await ingestNativeCreateTelegramAttachments(client, {
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    attachments: [
      {
        kind: "file",
        downloadUrl: "",
        fileName: input.fileName ?? "file",
        telegramFileId: input.fileId,
        declaredMime: input.mimeType,
      },
    ],
  });
  if (!native) return null;
  return nativeReplyToTelegram(native);
}

export async function handleExternalPersonTelegramVideo(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    fileId: string;
    fileName: string | null;
    mimeType: string | null;
  },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  const { ingestNativeCreateTelegramAttachments } = await import("../native-create/photo-ingest");
  const { nativeReplyToTelegram } = await import("../native-create/adapters");
  const native = await ingestNativeCreateTelegramAttachments(client, {
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    attachments: [
      {
        kind: "video",
        downloadUrl: "",
        fileName: input.fileName ?? "video.mp4",
        telegramFileId: input.fileId,
        declaredMime: input.mimeType,
      },
    ],
  });
  if (!native) return null;
  return nativeReplyToTelegram(native);
}
