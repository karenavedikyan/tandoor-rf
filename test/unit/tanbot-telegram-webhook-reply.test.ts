import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maybeSendWebhookReply } from "../../src/tanbot-telegram/webhook-handler";
import type { TanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { mockTelegramReplyDeliveryPool } from "../helpers/mock-telegram-reply-pool";

const config = {
  deliveryEnabled: true,
  botToken: "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst",
  requestTimeoutMs: 1000,
  maxResponseBytes: 4096,
} as TanbotTelegramStage2Config;

describe("tanbot webhook reply delivery", () => {
  it("retries send on duplicate update when first transport attempt failed", async () => {
    let calls = 0;
    const pool = mockTelegramReplyDeliveryPool({ updateId: 42, replyText: "hello" });
    const transport = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, code: "NETWORK_ERROR", retryable: true };
      return { ok: true, code: "OK" };
    };
    const reply = { chatId: 1n, text: "hello" };
    const first = await maybeSendWebhookReply(pool as never, config, transport, 42, reply);
    assert.equal(first?.ok, false);
    const second = await maybeSendWebhookReply(pool as never, config, transport, 42, reply);
    assert.equal(second?.ok, true);
    assert.equal(calls, 2);
  });
});
