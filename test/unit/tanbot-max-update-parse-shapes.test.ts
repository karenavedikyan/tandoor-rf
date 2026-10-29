import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaxWebhookUpdate } from "../../src/tanbot-max/update-parse";

describe("tanbot max documented update shapes", () => {
  it("parses message_created without top-level chat_id", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "message_created",
      timestamp: 100,
      message: {
        sender: { user_id: 5, is_bot: false, username: "u" },
        recipient: { chat_id: 900, chat_type: "chat" },
        body: { mid: "mid-1", text: "/stop" },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.update.chatId, 900n);
      assert.equal(parsed.update.commandText, "/stop");
    }
  });

  it("parses bot_stopped with top-level user_id", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "bot_stopped",
      timestamp: 200,
      user_id: 777,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.update.maxUserId, 777n);
  });

  it("parses message_callback payload", () => {
    const parsed = parseMaxWebhookUpdate({
      update_type: "message_callback",
      timestamp: 300,
      callback: {
        callback_id: "cb1",
        payload: "hc:gen:PUB1",
        user: { user_id: 11, is_bot: false },
      },
      message: {
        recipient: { chat_id: 55 },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.update.callbackPayload, "hc:gen:PUB1");
  });
});
