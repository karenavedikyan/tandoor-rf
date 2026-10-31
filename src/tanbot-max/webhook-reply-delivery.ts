import type { Pool, PoolClient } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport, MaxDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markMaxReplyDelivered, updateMaxReplyExtra } from "./webhook-inbox";
import { parseMaxReplyExtra } from "../tanbot/webhook-reply-extra";
import { deliverMaxNativeMediaFromExtra } from "../tanbot/native-create/media-delivery";
import { mergeReplyExtraRecord, NATIVE_MEDIA_PROGRESS_KEY } from "../tanbot/native-create/reply-media";

function mediaDeliveryComplete(extra: Record<string, unknown>): boolean {
  const parsed = parseMaxReplyExtra(extra);
  const queueLen = parsed.nativeMediaQueue?.length ?? 0;
  const prog = parsed.nativeMediaProgress ?? {};
  if (!prog.textDelivered) return false;
  if (queueLen === 0) return true;
  return (prog.mediaDeliveredCount ?? 0) >= queueLen;
}

export async function deliverMaxWebhookReply(
  db: Pool | PoolClient,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  dedupKey: string,
  reply: WebhookReply,
  options: { storedExtra?: unknown } = {},
): Promise<MaxDeliveryResult | null> {
  if (!reply) return null;
  let extraRecord: Record<string, unknown> =
    options.storedExtra && typeof options.storedExtra === "object" && !Array.isArray(options.storedExtra)
      ? { ...(options.storedExtra as Record<string, unknown>) }
      : reply.replyExtra
        ? { ...reply.replyExtra }
        : {};
  const parsed = parseMaxReplyExtra(extraRecord);
  const progress = parsed.nativeMediaProgress ?? {};

  if (!progress.textDelivered) {
    const result = await transport({
      token: config.botToken,
      userId: reply.userId,
      text: reply.text,
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      inlineButtons: parsed.inlineButtons ?? reply.inlineButtons,
    });
    if (!result.ok) return result;
    extraRecord = mergeReplyExtraRecord(extraRecord, {
      [NATIVE_MEDIA_PROGRESS_KEY]: {
        textDelivered: true,
        mediaDeliveredCount: progress.mediaDeliveredCount ?? 0,
      },
    });
    await updateMaxReplyExtra(db, dedupKey, extraRecord);
  }

  const scope = parsed.nativeMediaScope;
  if (scope && (parsed.nativeMediaQueue?.length ?? 0) > 0) {
    const media = await deliverMaxNativeMediaFromExtra(db, config, transport, {
      userId: reply.userId,
      replyExtra: extraRecord,
      messengerChatId: scope.messengerChatId,
      actor: scope.actor,
    });
    extraRecord = media.extra;
    await updateMaxReplyExtra(db, dedupKey, extraRecord);
    if (!media.ok) {
      return { ok: false, code: "MEDIA_DELIVERY", message: "Native media delivery failed.", retryable: true };
    }
  }

  if (mediaDeliveryComplete(extraRecord)) {
    await markMaxReplyDelivered(db, dedupKey);
  }
  return { ok: true, result: {} };
}
