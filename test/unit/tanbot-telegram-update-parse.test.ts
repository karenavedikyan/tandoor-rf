import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTelegramWebhookUpdate } from "../../src/tanbot-telegram/update-parse";

describe("tanbot telegram update parse", () => {
  it("accepts private /start with payload", () => {
    const parsed = parseTelegramWebhookUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 42, is_bot: false, first_name: "A", username: "emp_a" },
        chat: { id: 42, type: "private", first_name: "A" },
        date: 1,
        text: "/start abc123token",
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.parsed.kind, "message");
      if (parsed.parsed.kind === "message") {
        assert.equal(parsed.parsed.update.startPayload, "abc123token");
        assert.equal(parsed.parsed.update.telegramUserId, 42n);
      }
    }
  });

  it("rejects group chat", () => {
    const parsed = parseTelegramWebhookUpdate({
      update_id: 2,
      message: {
        message_id: 1,
        from: { id: 42, is_bot: false },
        chat: { id: -100, type: "group" },
        date: 1,
        text: "/start x",
      },
    });
    assert.equal(parsed.ok, false);
  });
});
