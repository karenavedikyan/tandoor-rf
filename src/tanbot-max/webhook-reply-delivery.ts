import type { Pool, PoolClient } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport, MaxDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markMaxReplyDelivered } from "./webhook-inbox";
import {
  loadMaxReplyRow,
  markMaxExtraProgress,
  maxExtraFromStored,
  nextMaxDeliveryStep,
  persistMaxReplyExtra,
} from "../tanbot/webhook-reply-pair-delivery";
import { isHandoffReplyFullyDelivered } from "../tanbot/webhook-reply-extra";

export async function deliverMaxWebhookReply(
  db: Pool | PoolClient,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  dedupKey: string,
  reply: WebhookReply,
): Promise<MaxDeliveryResult | null> {
  if (!reply) return null;

  const stored = await loadMaxReplyRow(db, dedupKey);
  let extra = maxExtraFromStored(stored?.reply_extra);
  const primaryText = stored?.reply_text ?? reply.text;

  let lastResult: MaxDeliveryResult | null = null;

  for (let guard = 0; guard < 3; guard++) {
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
      extra = markMaxExtraProgress(extra, "primary");
      await persistMaxReplyExtra(db, dedupKey, extra);
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
      extra = markMaxExtraProgress(extra, "copyOnly");
      await persistMaxReplyExtra(db, dedupKey, extra);
    }
  }

  if (isHandoffReplyFullyDelivered(extra)) {
    await markMaxReplyDelivered(db, dedupKey);
  }
  return lastResult;
}
