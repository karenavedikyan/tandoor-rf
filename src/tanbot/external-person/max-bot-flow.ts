import type { PoolClient } from "pg";
import { getAppOrigin } from "../../config";
import {
  createPersonBrowserSession,
  findPersonByMessenger,
  upsertVerifiedPerson,
} from "../../tan-tracker/external-person/person-service";
import { isExternalMessengerFeatureEnabled } from "../../tan-tracker/external-messenger/config";
import { findAccountByMaxUserId } from "../../tanbot-max/link-repository";
import { menuReplyKeyboard } from "../native-create/keyboards";
import { tryNativeCreateMaxMessage, tryNativeCreateMaxPhoto } from "../native-create/adapters";

export type ExternalPersonBotReply = {
  text: string;
  requestContact?: boolean;
  replyMarkup?: Record<string, unknown>;
  inlineButtons?: import("../../tanbot-max/delivery-transport").MaxInlineButton[][];
};

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
    text: `Номер подтверждён. Откройте «Мои передачи» или «Создать передачу»:\n${url}`,
    replyMarkup: menuReplyKeyboard(),
  };
}

export async function handleExternalPersonMaxMessage(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    text: string;
    firstName: string | null;
    recipientChatType?: string | null;
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
      replyMarkup: menuReplyKeyboard(),
    };
  }

  const native = await tryNativeCreateMaxMessage(client, {
    chatId: input.chatId,
    maxUserId: input.maxUserId,
    text: input.text,
    recipientChatType: input.recipientChatType,
  });
  if (!native) return null;
  return { ...native, inlineButtons: native.inlineButtons };
}

export async function handleExternalPersonMaxPhoto(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    downloadUrl: string;
    fileName: string | null;
    recipientChatType?: string | null;
    mediaToken?: string | null;
    images?: Array<{
      downloadUrl: string;
      fileName: string;
      mediaToken?: string | null;
      ingestReject?: import("./max-image-parse").MaxImageIngestReject;
    }>;
  },
): Promise<ExternalPersonBotReply | null> {
  if (!isExternalMessengerFeatureEnabled()) return null;
  const images =
    input.images?.length ?
      input.images
    : [
        {
          downloadUrl: input.downloadUrl,
          fileName: input.fileName ?? "photo.jpg",
          mediaToken: input.mediaToken,
        },
      ];
  const { ingestNativeCreateMaxPhotos } = await import("../native-create/photo-ingest");
  const { nativeReplyToMax } = await import("../native-create/adapters");
  const native = await ingestNativeCreateMaxPhotos(client, {
    chatId: input.chatId,
    maxUserId: input.maxUserId,
    recipientChatType: input.recipientChatType,
    images,
  });
  if (!native) return null;
  const out = nativeReplyToMax(native);
  return { text: out.text, replyMarkup: out.replyMarkup, inlineButtons: out.inlineButtons };
}
