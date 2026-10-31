import type { Pool } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport, MaxDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markMaxReplyDelivered, updateMaxReplyExtra } from "./webhook-inbox";
import {
  loadMaxReplyRowLocked,
  maxExtraFromStored,
  mergeMaxReplyDeliveryProgress,
  nextMaxDeliveryStep,
  withMaxReplyDeliveryLock,
} from "../tanbot/webhook-reply-pair-delivery";
import { isHandoffReplyFullyDelivered } from "../tanbot/webhook-reply-extra";
import { deliverMaxNativeMediaFromExtra } from "../tanbot/native-create/media-delivery";

async function deliverMaxWebhookReplyUnderLock(
  client: import("pg").PoolClient,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  dedupKey: string,
  reply: WebhookReply,
): Promise<MaxDeliveryResult | null> {
  if (!reply) return null;

  let row = await loadMaxReplyRowLocked(client, dedupKey);
  if (!row || row.reply_delivered_at) return null;

  let extra = maxExtraFromStored(row.reply_extra);
  const primaryText = row.reply_text ?? reply.text;

  let lastResult: MaxDeliveryResult | null = null;

  for (let guard = 0; guard < 12; guard++) {
    row = await loadMaxReplyRowLocked(client, dedupKey);
    if (!row || row.reply_delivered_at) break;
    extra = maxExtraFromStored(row.reply_extra);
    const step = nextMaxDeliveryStep(extra);
    if (step === "done") break;

    if (step === "primary") {
      lastResult = await transport({
        token: config.botToken,
        userId: reply.userId,
        text: primaryText,
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        inlineButtons: extra.inlineButtons ?? reply.inlineButtons,
      });
      if (!lastResult.ok) return lastResult;
      await mergeMaxReplyDeliveryProgress(client, dedupKey, "primary");
      continue;
    }

    if (step === "copyOnly" && extra.copyOnlyCode) {
      lastResult = await transport({
        token: config.botToken,
        userId: reply.userId,
        text: extra.copyOnlyCode,
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      });
      if (!lastResult.ok) return lastResult;
      await mergeMaxReplyDeliveryProgress(client, dedupKey, "copyOnly");
      continue;
    }

    if (step === "nativeMedia") {
      const scope = extra.nativeMediaScope;
      if (!scope) break;
      const media = await deliverMaxNativeMediaFromExtra(client, config, transport, {
        userId: reply.userId,
        replyExtra: row.reply_extra,
        scope,
      });
      await updateMaxReplyExtra(client, dedupKey, media.extra);
      if (!media.ok) {
        return {
          ok: false,
          code: "MEDIA_DELIVERY",
          message: "Native media delivery failed.",
          retryable: media.retryable !== false,
        };
      }
      continue;
    }
  }

  row = await loadMaxReplyRowLocked(client, dedupKey);
  extra = maxExtraFromStored(row?.reply_extra);
  if (row && !row.reply_delivered_at && isHandoffReplyFullyDelivered(extra)) {
    await markMaxReplyDelivered(client, dedupKey);
  }
  return lastResult ?? { ok: true, result: {} };
}

export async function deliverMaxWebhookReply(
  pool: Pool,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  dedupKey: string,
  reply: WebhookReply,
): Promise<MaxDeliveryResult | null> {
  return withMaxReplyDeliveryLock(pool, dedupKey, (client) =>
    deliverMaxWebhookReplyUnderLock(client, config, transport, dedupKey, reply),
  );
}
