import type { Pool, PoolClient } from "pg";
import type { TanbotMaxStage2Config } from "../../tanbot-max/stage2-config";
import type { TanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import type { MaxDeliveryTransport } from "../../tanbot-max/delivery-transport";
import type { TelegramDeliveryTransport } from "../../tanbot-telegram/delivery-transport";
import {
  type NativeMediaDeliveryProgress,
  type NativeReplyMediaItem,
  NATIVE_MEDIA_PROGRESS_KEY,
  markNativeMediaTerminalCanceled,
  mergeReplyExtraRecord,
  readNativeMediaProgress,
  readNativeMediaQueue,
} from "./reply-media";
import { loadNativeBotDraft, type NativeCreateDraftPayload } from "./draft-scope";
import type { NativeMediaScope } from "./webhook-reply-bridge";
import type { NativeCreateContext } from "./engine";
import {
  assertDraftBoundToCaller,
  assertDraftPersonRow,
  assertNativeCreateContext,
} from "./access-guard";

type Db = Pool | PoolClient;

export type NativeMediaDeliveryResult = {
  ok: boolean;
  retryable?: boolean;
  progress: NativeMediaDeliveryProgress;
  extra: Record<string, unknown>;
};

function extraRecordFrom(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function scopeChannel(scope: NativeMediaScope, item: NativeReplyMediaItem): "telegram" | "max" {
  return scope.channel ?? item.channel;
}

async function buildMediaDeliveryContext(
  scope: NativeMediaScope,
  channel: "telegram" | "max",
  draftPayload: NativeCreateDraftPayload,
  personId: string | null,
): Promise<NativeCreateContext> {
  const messengerUserId = BigInt(scope.messengerUserId);
  const isStaff = scope.actor === "staff";
  return {
    channel,
    messengerChatId: scope.messengerChatId,
    messengerUserId,
    privateDialogOk: true,
    isLinkedStaff: isStaff,
    staffUserId: isStaff ? draftPayload.staffUserId ?? null : null,
    personId: isStaff ? null : personId,
  };
}

async function validateMediaItemSend(
  client: Db,
  item: NativeReplyMediaItem,
  scope: NativeMediaScope,
): Promise<{ ok: true } | { ok: false; terminal: true; reason: string } | { ok: false; terminal: false }> {
  const channel = scopeChannel(scope, item);
  const draft = await loadNativeBotDraft(client, channel, scope.messengerChatId, scope.actor);
  if (!draft || draft.id !== item.draftId) {
    return { ok: false, terminal: true, reason: "draft_invalid" };
  }
  const file = await client.query<{ n: number }>(
    `SELECT 1 AS n FROM tt_external_request_draft_files WHERE draft_id = $1::uuid AND sort_order = $2`,
    [item.draftId, item.sortOrder],
  );
  if ((file.rowCount ?? 0) === 0) {
    return { ok: false, terminal: true, reason: "file_missing" };
  }
  const payload = draft.payload as NativeCreateDraftPayload;
  const ctx = await buildMediaDeliveryContext(scope, channel, payload, draft.person_id);
  try {
    await assertNativeCreateContext(client as PoolClient, ctx);
    assertDraftBoundToCaller(payload, ctx);
    assertDraftPersonRow(draft, ctx);
  } catch {
    return { ok: false, terminal: true, reason: "permission_denied" };
  }
  return { ok: true };
}

export async function deliverTelegramNativeMediaFromExtra(
  client: Db,
  config: TanbotTelegramStage2Config,
  transport: TelegramDeliveryTransport,
  input: {
    chatId: bigint;
    replyExtra: unknown;
    scope: NativeMediaScope;
  },
): Promise<NativeMediaDeliveryResult> {
  const extraRecord = extraRecordFrom(input.replyExtra);
  const queue = readNativeMediaQueue(extraRecord);
  const progress = readNativeMediaProgress(extraRecord);
  if (progress.disposition === "canceled") {
    return { ok: true, progress, extra: extraRecord };
  }
  let mediaDeliveredCount = progress.mediaDeliveredCount ?? 0;
  if (!queue.length || mediaDeliveredCount >= queue.length) {
    return { ok: true, progress, extra: extraRecord };
  }
  for (let i = mediaDeliveredCount; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.channel !== "telegram" || !item.telegramFileId) {
      return {
        ok: false,
        retryable: false,
        progress: { mediaDeliveredCount },
        extra: markNativeMediaTerminalCanceled(extraRecord, "invalid_queue_item", mediaDeliveredCount),
      };
    }
    const gate = await validateMediaItemSend(client, item, input.scope);
    if (!gate.ok) {
      if (gate.terminal) {
        return {
          ok: true,
          progress: { mediaDeliveredCount, disposition: "canceled", cancelReason: gate.reason },
          extra: markNativeMediaTerminalCanceled(extraRecord, gate.reason, mediaDeliveredCount),
        };
      }
      return { ok: false, retryable: true, progress: { mediaDeliveredCount }, extra: extraRecord };
    }
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
        retryable: result.retryable !== false,
        progress: { mediaDeliveredCount },
        extra: mergeReplyExtraRecord(extraRecord, {
          [NATIVE_MEDIA_PROGRESS_KEY]: { mediaDeliveredCount },
        }),
      };
    }
    mediaDeliveredCount += 1;
    extraRecord[NATIVE_MEDIA_PROGRESS_KEY] = { mediaDeliveredCount };
  }
  return {
    ok: true,
    progress: { mediaDeliveredCount },
    extra: mergeReplyExtraRecord(extraRecord, {
      [NATIVE_MEDIA_PROGRESS_KEY]: { mediaDeliveredCount },
    }),
  };
}

export async function deliverMaxNativeMediaFromExtra(
  client: Db,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  input: {
    userId: bigint;
    replyExtra: unknown;
    scope: NativeMediaScope;
  },
): Promise<NativeMediaDeliveryResult> {
  const extraRecord = extraRecordFrom(input.replyExtra);
  const queue = readNativeMediaQueue(extraRecord);
  const progress = readNativeMediaProgress(extraRecord);
  if (progress.disposition === "canceled") {
    return { ok: true, progress, extra: extraRecord };
  }
  let mediaDeliveredCount = progress.mediaDeliveredCount ?? 0;
  if (!queue.length || mediaDeliveredCount >= queue.length) {
    return { ok: true, progress, extra: extraRecord };
  }
  for (let i = mediaDeliveredCount; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.channel !== "max" || !item.maxFileToken) {
      return {
        ok: false,
        retryable: false,
        progress: { mediaDeliveredCount },
        extra: markNativeMediaTerminalCanceled(extraRecord, "invalid_queue_item", mediaDeliveredCount),
      };
    }
    const gate = await validateMediaItemSend(client, item, input.scope);
    if (!gate.ok) {
      if (gate.terminal) {
        return {
          ok: true,
          progress: { mediaDeliveredCount, disposition: "canceled", cancelReason: gate.reason },
          extra: markNativeMediaTerminalCanceled(extraRecord, gate.reason, mediaDeliveredCount),
        };
      }
      return { ok: false, retryable: true, progress: { mediaDeliveredCount }, extra: extraRecord };
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
        retryable: result.retryable !== false,
        progress: { mediaDeliveredCount },
        extra: mergeReplyExtraRecord(extraRecord, {
          [NATIVE_MEDIA_PROGRESS_KEY]: { mediaDeliveredCount },
        }),
      };
    }
    mediaDeliveredCount += 1;
    extraRecord[NATIVE_MEDIA_PROGRESS_KEY] = { mediaDeliveredCount };
  }
  return {
    ok: true,
    progress: { mediaDeliveredCount },
    extra: mergeReplyExtraRecord(extraRecord, {
      [NATIVE_MEDIA_PROGRESS_KEY]: { mediaDeliveredCount },
    }),
  };
}
