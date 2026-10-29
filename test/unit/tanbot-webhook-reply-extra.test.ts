import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maxReplyExtraFromReply,
  parseMaxReplyExtra,
  parseTelegramReplyExtra,
  telegramReplyExtraFromReply,
} from "../../src/tanbot/webhook-reply-extra";

describe("tanbot webhook reply extra", () => {
  it("round-trips telegram inline keyboard", () => {
    const markup = {
      inline_keyboard: [[{ text: "Получить код: X", callback_data: "hc:gen:X" }]],
    };
    const extra = telegramReplyExtraFromReply({ replyMarkup: markup, answerCallbackQueryId: "cq1" });
    assert.ok(extra);
    const parsed = parseTelegramReplyExtra(extra);
    assert.deepEqual(parsed.replyMarkup, markup);
    assert.equal(parsed.answerCallbackQueryId, "cq1");
  });

  it("round-trips max inline buttons", () => {
    const buttons = [[{ text: "Получить код: Y", payload: "hc:gen:Y" }]];
    const extra = maxReplyExtraFromReply({ inlineButtons: buttons });
    assert.ok(extra);
    const parsed = parseMaxReplyExtra(extra);
    assert.deepEqual(parsed.inlineButtons, buttons);
  });
});
