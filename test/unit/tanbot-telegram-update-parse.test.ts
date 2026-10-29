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

  it("rejects private chat when chat id differs from sender user id", () => {
    const parsed = parseTelegramWebhookUpdate({
      update_id: 3,
      message: {
        message_id: 1,
        from: { id: 800001, is_bot: false, first_name: "A" },
        chat: { id: 900001, type: "private" },
        date: 1,
        contact: { phone_number: "+79991112233", user_id: 800001, first_name: "A" },
      },
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.reason, "private_chat_user_mismatch");
    }
  });

  it("marks contact as forwarded when forward_origin is set (modern API)", () => {
    const parsed = parseTelegramWebhookUpdate({
      update_id: 4,
      message: {
        message_id: 1,
        from: { id: 42, is_bot: false, first_name: "A" },
        chat: { id: 42, type: "private" },
        date: 1,
        forward_origin: {
          type: "user",
          sender_user: { id: 99, is_bot: false, first_name: "Other" },
          date: 1,
        },
        contact: { phone_number: "+79991112233", user_id: 42, first_name: "A" },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok && parsed.parsed.kind === "contact") {
      assert.equal(parsed.parsed.update.isForwarded, true);
    } else {
      assert.fail("expected contact update");
    }
  });

  it("marks contact as forwarded for legacy forward_date without forward_origin", () => {
    const parsed = parseTelegramWebhookUpdate({
      update_id: 5,
      message: {
        message_id: 1,
        from: { id: 42, is_bot: false, first_name: "A" },
        chat: { id: 42, type: "private" },
        date: 1,
        forward_date: 1,
        contact: { phone_number: "+79991112233", user_id: 42, first_name: "A" },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok && parsed.parsed.kind === "contact") {
      assert.equal(parsed.parsed.update.isForwarded, true);
    } else {
      assert.fail("expected contact update");
    }
  });
});
