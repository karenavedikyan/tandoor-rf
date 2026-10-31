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
import { appendNativeCreateDraftPhoto, photoCountForDraft } from "./photo-store";
import { navError, renderDraftPrompt } from "./engine";

export type NormalizedMessengerImage = {
  downloadUrl: string;
  fileName: string;
  mediaToken?: string | null;
  telegramFileId?: string | null;
};

function photoStepFeedback(added: number, countAfter: number, errors: string[]): string {
  const parts: string[] = [];
  if (added > 0) {
    parts.push(added === 1 ? "Добавлено 1 фото." : `Добавлено ${added} фото.`);
    parts.push(`Фото: ${countAfter}/5.`);
  }
  for (const e of errors) parts.push(e);
  return parts.join("\n");
}

async function ingestNativeCreatePhotos(
  client: PoolClient,
  ctx: Awaited<ReturnType<typeof buildTelegramNativeCreateContext>>,
  images: NormalizedMessengerImage[],
  fetchOne: (img: NormalizedMessengerImage) => Promise<
    | { ok: true; buffer: Buffer; mimeType: string; fileName: string; telegramFileId?: string | null; maxFileToken?: string | null }
    | { ok: false; message: string }
  >,
): Promise<NativeCreateReply | null> {
  if (!images.length) return null;

  await lockNativeCreateMessenger(client, ctx);
  try {
    await assertNativeCreateContext(client, ctx);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Действие недоступно.";
    return navError(message, ctx.channel);
  }

  const actor = ctx.isLinkedStaff ? "staff" : "external";
  const draft = await loadNativeBotDraft(client, ctx.channel, ctx.messengerChatId, actor, { forUpdate: true });
  if (!draft || draft.step !== "photo") return null;
  assertDraftPersonRow(draft, ctx);
  const payload = { ...(draft.payload as import("./draft-scope").NativeCreateDraftPayload) };
  assertDraftBoundToCaller(payload, ctx);

  let added = 0;
  const errors: string[] = [];
  let count = await photoCountForDraft(client, draft.id);

  for (const img of images) {
    if (count >= 5) {
      errors.push("Достигнут лимит 5 фото. Нажмите «Далее».");
      break;
    }
    const fetched = await fetchOne(img);
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
    added += 1;
    count += 1;
  }

  if (added === 0 && errors.length === 0) return null;

  const nextPayload =
    added > 0 ? await bumpDraftRevision(client, draft.id, "photo", payload) : payload;
  const rendered = await renderDraftPrompt(client, ctx.channel, draft.id, "photo", nextPayload);
  const prefix = photoStepFeedback(added, count, errors);
  if (prefix) {
    rendered.text = `${prefix}\n\n${rendered.text}`;
  }
  return rendered;
}

export async function ingestNativeCreateTelegramPhotos(
  client: PoolClient,
  input: {
    chatId: bigint;
    telegramUserId: bigint;
    images: NormalizedMessengerImage[];
  },
): Promise<NativeCreateReply | null> {
  const ctx = await buildTelegramNativeCreateContext(client, {
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    privateDialogOk: true,
  });
  const { fetchTelegramFileBytes } = await import("../../tanbot-telegram/file-fetch");
  return ingestNativeCreatePhotos(client, ctx, input.images, async (img) => {
    const fileId = img.telegramFileId?.trim();
    if (!fileId) {
      return { ok: false, message: "Не удалось принять фото. Отправьте изображение ещё раз." };
    }
    const bytes = await fetchTelegramFileBytes(fileId);
    if (!bytes.ok) return { ok: false, message: bytes.message };
    return {
      ok: true,
      buffer: bytes.buffer,
      mimeType: bytes.mimeType,
      fileName: img.fileName || "photo.jpg",
      telegramFileId: fileId,
    };
  });
}

export async function ingestNativeCreateMaxPhotos(
  client: PoolClient,
  input: {
    chatId: bigint;
    maxUserId: bigint;
    recipientChatType?: string | null;
    images: NormalizedMessengerImage[];
  },
): Promise<NativeCreateReply | null> {
  const ctx = await buildMaxNativeCreateContext(client, {
    chatId: input.chatId,
    maxUserId: input.maxUserId,
    recipientChatType: input.recipientChatType,
  });
  const { fetchMaxImageBytes } = await import("../../tanbot-max/file-fetch");
  return ingestNativeCreatePhotos(client, ctx, input.images, async (img) => {
    if (!img.downloadUrl?.trim()) {
      return {
        ok: false,
        message: "Изображение принимается только с серверов MAX. Отправьте фото заново из чата.",
      };
    }
    const bytes = await fetchMaxImageBytes(img.downloadUrl);
    if (!bytes.ok) return { ok: false, message: bytes.message };
    return {
      ok: true,
      buffer: bytes.buffer,
      mimeType: bytes.mimeType,
      fileName: img.fileName || "photo.jpg",
      maxFileToken: img.mediaToken,
    };
  });
}
