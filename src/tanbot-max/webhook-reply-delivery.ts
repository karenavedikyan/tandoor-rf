import type { Pool, PoolClient } from "pg";
import type { TanbotMaxStage2Config } from "./stage2-config";
import type { MaxDeliveryTransport, MaxDeliveryResult } from "./delivery-transport";
import type { WebhookReply } from "./webhook-handler";
import { markMaxReplyDelivered } from "./webhook-inbox";

export async function deliverMaxWebhookReply(
  db: Pool | PoolClient,
  config: TanbotMaxStage2Config,
  transport: MaxDeliveryTransport,
  dedupKey: string,
  reply: WebhookReply,
): Promise<MaxDeliveryResult | null> {
  if (!reply) return null;
  const result = await transport({
    token: config.botToken,
    userId: reply.userId,
    text: reply.text,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    inlineButtons: reply.inlineButtons,
  });
  if (result.ok) {
    await markMaxReplyDelivered(db, dedupKey);
  }
  return result;
}
