import type { Pool, PoolClient } from "pg";
import type { TanbotMaxStage2Config } from "../../tanbot-max/stage2-config";
import type { TanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import type { MaxDeliveryTransport } from "../../tanbot-max/delivery-transport";
import type { TelegramDeliveryTransport } from "../../tanbot-telegram/delivery-transport";
import {
  type NativeMediaDeliveryProgress,
  type NativeReplyMediaItem,
  NATIVE_MEDIA_PROGRESS_KEY,
  NATIVE_MEDIA_QUEUE_KEY,
  mergeReplyExtraRecord,
  readNativeMediaProgress,
  readNativeMediaQueue,
} from "./reply-media";
import { loadNativeBotDraft, type NativeCreateActorKind } from "./draft-scope";

type Db = Pool | PoolClient;

async function nativeMediaDraftStillValid(
  client: Db,
  item: NativeReplyMediaItem,
  messengerChatId: string,
  actor: NativeCreateActorKind,
): Promise<boolean> {
  const draft = await loadNativeBotDraft(client, item.channel, messengerChatId, actor);
  if (!draft || draft.id !== item.draftId) return false;
  const file = await client.query<{ n: number }>(
    `SELECT 1 AS n FROM tt_external_request_draft_files WHERE draft_id = $1::uuid AND sort_order = $2`,
    [item.draftId, item.sortOrder],
  );
  return (file.rowCount ?? 0) > 0;
}

export async function deliverTelegramNativeMediaFromExtra(
  client: Db,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport,
  input: {
    chatId: bigint;
    replyExtra: unknown;
    messengerChatId: string;
    actor: NativeCreateActorKind;
  },
): Promise<{ ok: boolean; progress: NativeMediaDeliveryProgress; extra: Record<string, unknown> }> {
  const extraRecord =
    input.replyExtra && typeof input.replyExtra === "object" && !Array.isArray(input.replyExtra)
      ? (input.replyExtra as Record<string, unknown>)
      : {};
  const queue = readNativeMediaQueue(extraRecord);
  const progress = readNativeMediaProgress(extraRecord);
  let mediaDeliveredCount = progress.mediaDeliveredCount ?? 0;
  if (!queue.length || mediaDeliveredCount >= queue.length) {
    return { ok: true, progress, extra: extraRecord };
  }
  for (let i = mediaDeliveredCount; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.channel !== "telegram" || !item.telegramFileId) return { ok: false, progress: { textDelivered: progress.textDelivered, mediaDeliveredCount }, extra: extraRecord };
    const valid = await nativeMediaDraftStillValid(client, item, input.messengerChatId, input.actor);
    if (!valid) return { ok: false, progress: { textDelivered: progress.textDelivered, mediaDeliveredCount }, extra: extraRecord };
    const body: Record<string, unknown> = {
      chat_id: input.chatId.toString(),
      photo: item.telegramFileId,
    };
    if (item.caption) body.caption = item.caption;
    const result = await transport({
      method: "sendPhoto",
      token: config.botToken,
      body,
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    });
    if (!result.ok) {
      return {
        ok: false,
        progress: { textDelivered: progress.textDelivered, mediaDeliveredCount },
        extra: mergeReplyExtraRecord(extraRecord, {
          [NATIVE_MEDIA_PROGRESS_KEY]: { textDelivered: progress.textDelivered, mediaDeliveredCount },
        }),
      };
    }
    mediaDeliveredCount += 1;
  }
  const nextExtra = mergeReplyExtraRecord(extraRecord, {
    [NATIVE_MEDIA_PROGRESS_KEY]: { textDelivered: progress.textDelivered, mediaDeliveredCount },
  });
  return { ok: true, progress: { textDelivered: progress.textDelivered, mediaDeliveredCount }, extra: nextExtra };
}

export async function deliverMaxNativeMediaFromExtra(
  client: Db,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  input: {
    userId: bigint;
    replyExtra: unknown;
    messengerChatId: string;
    actor: NativeCreateActorKind;
  },
): Promise<{ ok: boolean; progress: NativeMediaDeliveryProgress; extra: Record<string, unknown> }> {
  const extraRecord =
    input.replyExtra && typeof input.replyExtra === "object" && !Array.isArray(input.replyExtra)
      ? (input.replyExtra as Record<string, unknown>)
      : {};
  const queue = readNativeMediaQueue(extraRecord);
  const progress = readNativeMediaProgress(extraRecord);
  let mediaDeliveredCount = progress.mediaDeliveredCount ?? 0;
  if (!queue.length || mediaDeliveredCount >= queue.length) {
    return { ok: true, progress, extra: extraRecord };
  }
  for (let i = mediaDeliveredCount; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.channel !== "max" || !item.maxFileToken) {
      return { ok: false, progress: { textDelivered: progress.textDelivered, mediaDeliveredCount }, extra: extraRecord };
    }
    const valid = await nativeMediaDraftStillValid(client, item, input.messengerChatId, input.actor);
    if (!valid) {
      return { ok: false, progress: { textDelivered: progress.textDelivered, mediaDeliveredCount }, extra: extraRecord };
    }
    const caption = item.caption ? `Фото: ${item.caption}` : "Фото";
    const result = await transport({
      token: config.botToken,
      userId: input.userId,
      text: caption,
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      maxImageToken: item.maxFileToken,
    });
    if (!result.ok) {
      return {
        ok: false,
        progress: { textDelivered: progress.textDelivered, mediaDeliveredCount },
        extra: mergeReplyExtraRecord(extraRecord, {
          [NATIVE_MEDIA_PROGRESS_KEY]: { textDelivered: progress.textDelivered, mediaDeliveredCount },
        }),
      };
    }
    mediaDeliveredCount += 1;
  }
  const nextExtra = mergeReplyExtraRecord(extraRecord, {
    [NATIVE_MEDIA_PROGRESS_KEY]: { textDelivered: progress.textDelivered, mediaDeliveredCount },
  });
  return { ok: true, progress: { textDelivered: progress.textDelivered, mediaDeliveredCount }, extra: nextExtra };
}
