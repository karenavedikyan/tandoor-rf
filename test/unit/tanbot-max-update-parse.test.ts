import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaxWebhookUpdate } from "../../src/tanbot-max/update-parse";
import { computeMaxUpdateDedupKey } from "../../src/tanbot-max/update-dedup-key";

describe("tanbot max update parse", () => {
  it("preserves published text-message dedup keys when photo normalization changes", () => {
    for (const sample of [
      { body: { text: "/status" }, expected: null, topMid: undefined },
      { body: { text: "/status", mid: "body-mid" }, expected: "body-mid", topMid: undefined },
      { body: { text: "/status", mid: " raw-body-mid " }, expected: " raw-body-mid ", topMid: undefined },
      { body: { text: "/status", mid: "" }, expected: "fallback-mid", topMid: "fallback-mid" },
    ]) {
      const parsed = parseMaxWebhookUpdate({
        update_type: "message_created", timestamp: 1729000000000,
        message: {
          sender: { user_id: 5, is_bot: false },
          recipient: { chat_id: 11, chat_type: "dialog" },
          body: sample.body, mid: sample.topMid,
        },
      });
      assert.ok(parsed.ok);
      assert.equal(parsed.update.commandText, "/status");
      assert.equal(parsed.update.dedupKey, computeMaxUpdateDedupKey({
        updateType: "message_created", timestamp: 1729000000000,
        chatId: 11, userId: 5, messageMid: sample.expected,
      }), "photo ingestion must not re-key already handled plain-text events");
    }
  });
  it("accepts bot_started with payload", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "bot_started",
      timestamp: 1737500130100,
      chat_id: 42,
      user: { user_id: 99, is_bot: false, username: "ivan", first_name: "Ivan" },
      payload: "link-token-abc",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.update.startPayload, "link-token-abc");
      assert.equal(parsed.update.maxUserId, 99n);
    }
  });

  it("accepts message_created with image attachments before caption text", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "message_created",
      timestamp: 99,
      chat_id: 10,
      message: {
        sender: { user_id: 5, is_bot: false },
        recipient: { chat_id: 11, chat_type: "dialog" },
        body: {
          mid: "mid-with-caption",
          text: "caption here",
          attachments: [{ type: "image", payload: { url: "https://iu.oneme.ru/getImage?token=abc" } }],
        },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok && "normalizedImages" in parsed.update) {
      assert.equal(parsed.update.normalizedImages?.length, 1);
      assert.equal(parsed.update.imageDownloadUrl, parsed.update.normalizedImages?.[0]?.downloadUrl);
    }
  });

  it("accepts message_created /status", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "message_created",
      timestamp: 1,
      chat_id: 10,
      message: {
        sender: { user_id: 5, is_bot: false },
        body: { text: "/status" },
        mid: "m1",
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.update.commandText, "/status");
  });
});
