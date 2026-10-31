import type { PoolClient } from "pg";
import type { NativeCreateReply } from "./engine";
import { buildMaxNativeCreateContext, buildTelegramNativeCreateContext } from "./adapters";
import {
  assertDraftBoundToCaller,
  assertDraftPersonRow,
  assertNativeCreateContext,
  lockNativeCreateMessenger,
} from "./access-guard";
import { bumpDraftRevision, loadNativeBotDraft } from "./draft-scope";
import {
  appendNativeCreateDraftPhoto,
  draftHasNonImageOnlyAttachments,
  photoCountForDraft,
} from "./photo-store";
import {
  formatNativeAttachmentStepFeedback,
  nativeAttachmentLimitMessage,
  type NativeAttachmentAddCounts,
} from "./attachment-feedback-text";
import { renderDraftPrompt } from "./engine";
import type { MaxImageIngestReject } from "../external-person/max-image-parse";
import type { MaxAttachmentKind } from "../external-person/max-attachment-parse";
import {
  maxProviderKindToTransport,
  recordNativeAttachmentTransportKind,
  type NativeAttachmentTransportKind,
} from "./native-attachment-transport-kind";
import { safeNativeAttachmentFileName } from "./native-attachment-magic";

export type NormalizedMessengerAttachment = {
  kind: MaxAttachmentKind;
  downloadUrl: string;
  fileName: string;
  mediaToken?: string | null;
  telegramFileId?: string | null;
  declaredSize?: number | null;
  declaredMime?: string | null;
  ingestReject?: MaxImageIngestReject;
};

/** @deprecated alias for images-only callers */
export type NormalizedMessengerImage = NormalizedMessengerAttachment;

function rejectMessage(reason: MaxImageIngestReject, kind: MaxAttachmentKind): string {
  switch (reason) {
    case "token_only":
      return kind === "video"
        ? "Не удалось загрузить видео по токену. Отправьте видео как файл."
        : kind === "file"
          ? "Не удалось загрузить файл по токену. Отправьте файл ещё раз."
          : "Не удалось загрузить изображение по токену. Отправьте фото ещё раз из галереи MAX.";
    case "unsafe_url":
      return kind === "video"
        ? "Ссылка на видео недоступна. Отправьте видео как файл."
        : "Ссылка на файл недоступна.";
    case "malformed":
      return kind === "video"
        ? "Не удалось получить видео. Отправьте видео как файл."
        : "Не удалось принять файл. Отправьте вложение ещё раз.";
  }
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function videoFallbackMessage(item: NormalizedMessengerAttachment, message: string): string {
  return item.kind === "video" && !/как\s+файл/iu.test(message)
    ? `${message} Отправьте видео как файл.`
    : message;
}

function transportKindFor(item: NormalizedMessengerAttachment): NativeAttachmentTransportKind {
  return maxProviderKindToTransport(item.kind);
}

async function ingestNativeCreateAttachments(
  client: PoolClient,
  ctx: Awaited<ReturnType<typeof buildTelegramNativeCreateContext>>,
  attachments: NormalizedMessengerAttachment[],
  fetchOne: (item: NormalizedMessengerAttachment) => Promise<
    | { ok: true; buffer: Buffer; mimeType: string; fileName: string; telegramFileId?: string | null; maxFileToken?: string | null }
    | { ok: false; message: string }
  >,
): Promise<NativeCreateReply | null> {
  if (!attachments.length) return null;

  await lockNativeCreateMessenger(client, ctx);
  try {
    await assertNativeCreateContext(client, ctx);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Действие недоступно.";
    const { navError } = await import("./engine");
    return navError(message, ctx.channel);
  }

  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor, { forUpdate: true });
  if (!draft || draft.step !== "photo") return null;
  assertDraftPersonRow(draft, ctx);
  const payload = { ...(draft.payload as import("./draft-scope").NativeCreateDraftPayload) };
  assertDraftBoundToCaller(payload, ctx);

  const added: NativeAttachmentAddCounts = { addedImages: 0, addedPdfs: 0, addedOther: 0 };
  const errors: string[] = [];
  let count = await photoCountForDraft(client, draft.id);
  let useGenericLabels = await draftHasNonImageOnlyAttachments(client, draft.id);
  for (const v of Object.values(payload.nativeAttachmentTransportBySort ?? {})) {
    if (v === "file" || v === "video") useGenericLabels = true;
  }

  for (const item of attachments) {
    if (count >= 5) {
      errors.push(nativeAttachmentLimitMessage(useGenericLabels));
      break;
    }
    if (item.ingestReject) {
      errors.push(rejectMessage(item.ingestReject, item.kind));
      continue;
    }
    if (item.declaredSize != null && item.declaredSize > MAX_ATTACHMENT_BYTES) {
      errors.push("Файл больше 8 МБ. Отправьте файл меньше.");
      continue;
    }
    const fetched = await fetchOne(item);
    if (!fetched.ok) {
      errors.push(fetched.message);
      continue;
    }
    const append = await appendNativeCreateDraftPhoto(client, {
      draftId: draft.id,
      sortOrder: count,
      buffer: fetched.buffer,
      mimeType: fetched.mimeType,
      fileName: fetched.fileName,
      telegramFileId: fetched.telegramFileId,
      maxFileToken: fetched.maxFileToken,
    });
    if (!append.ok) {
      errors.push(append.message);
      continue;
    }
    const transportKind = transportKindFor(item);
    recordNativeAttachmentTransportKind(payload, count, transportKind);
    if (item.kind === "image" && transportKind === "image") {
      added.addedImages += 1;
    } else if (fetched.mimeType === "application/pdf") {
      added.addedPdfs += 1;
      useGenericLabels = true;
    } else {
      added.addedOther += 1;
      useGenericLabels = true;
    }
    if (transportKind !== "image") useGenericLabels = true;
    count += 1;
  }

  const anyAdded = added.addedImages + added.addedPdfs + added.addedOther;
  if (anyAdded === 0 && errors.length === 0) return null;

  const nextPayload =
    anyAdded > 0 ? await bumpDraftRevision(client, draft.id, "photo", payload) : payload;
  const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, "photo", nextPayload);
  const prefix = formatNativeAttachmentStepFeedback(added, count, errors, useGenericLabels);
  rendered.text = `${prefix}\n\n${rendered.text}`;
  return rendered;
}

export async function ingestNativeCreateTelegramAttachments(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    attachments: NormalizedMessengerAttachment[];
  },
): Promise<NativeCreateReply | null> {
  const ctx = await buildTelegramNativeCreateContext(client, {
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    privateDialogOk: true,
  });
  const { fetchTelegramNativeAttachmentBytes } = await import("./native-attachment-fetch");
  return ingestNativeCreateAttachments(client, ctx, input.attachments, async (item) => {
    const fileId = item.telegramFileId?.trim();
    if (!fileId) {
      return { ok: false, message: "Не удалось принять файл. Отправьте вложение ещё раз." };
    }
    const bytes = await fetchTelegramNativeAttachmentBytes(fileId, item.kind);
    if (!bytes.ok) return { ok: false, message: videoFallbackMessage(item, bytes.message) };
    return {
      ok: true,
      buffer: bytes.buffer,
      mimeType: bytes.mimeType,
      fileName: safeNativeAttachmentFileName(item.fileName || "file"),
      telegramFileId: fileId,
    };
  });
}

export async function ingestNativeCreateMaxAttachments(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    recipientChatType?: string | null;
    attachments: NormalizedMessengerAttachment[];
  },
): Promise<NativeCreateReply | null> {
  const ctx = await buildMaxNativeCreateContext(client, {
    chatId: input.chatId,
    maxUserId: input.maxUserId,
    recipientChatType: input.recipientChatType,
  });
  const { fetchMaxNativeAttachmentBytes } = await import("./native-attachment-fetch");
  return ingestNativeCreateAttachments(client, ctx, input.attachments, async (item) => {
    if (!item.downloadUrl?.trim()) {
      return {
        ok: false,
        message: videoFallbackMessage(item, "Файл принимается только с серверов MAX. Отправьте вложение заново из чата."),
      };
    }
    const bytes = await fetchMaxNativeAttachmentBytes(item.downloadUrl, item.kind);
    if (!bytes.ok) return { ok: false, message: videoFallbackMessage(item, bytes.message) };
    return {
      ok: true,
      buffer: bytes.buffer,
      mimeType: bytes.mimeType,
      fileName: safeNativeAttachmentFileName(item.fileName || "file"),
      maxFileToken: item.mediaToken,
    };
  });
}

export async function ingestNativeCreateTelegramPhotos(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    images: NormalizedMessengerAttachment[];
  },
): Promise<NativeCreateReply | null> {
  return ingestNativeCreateTelegramAttachments(client, {
    ...input,
    attachments: input.images.map((img) => ({ ...img, kind: img.kind ?? "image" })),
  });
}

export async function ingestNativeCreateMaxPhotos(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    recipientChatType?: string | null;
    images: NormalizedMessengerAttachment[];
  },
): Promise<NativeCreateReply | null> {
  return ingestNativeCreateMaxAttachments(client, {
    ...input,
    attachments: input.images.map((img) => ({ ...img, kind: img.kind ?? "image" })),
  });
}
