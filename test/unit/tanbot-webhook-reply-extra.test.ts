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
    const buttons = [[{ type: "callback" as const, text: "Получить код: Y", payload: "hc:gen:Y" }]];
    const extra = maxReplyExtraFromReply({ inlineButtons: buttons });
    assert.ok(extra);
    const parsed = parseMaxReplyExtra(extra);
    assert.deepEqual(parsed.inlineButtons, buttons);
  });

  it("round-trips max request_contact button", () => {
    const buttons = [[{ type: "request_contact" as const, text: "Отправить мой номер" }]];
    const extra = maxReplyExtraFromReply({ inlineButtons: buttons });
    assert.ok(extra);
    const parsed = parseMaxReplyExtra(extra);
    assert.deepEqual(parsed.inlineButtons, buttons);
  });

  it("round-trips telegram request_contact reply keyboard", () => {
    const markup = {
      keyboard: [[{ text: "Отправить мой номер", request_contact: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    };
    const extra = telegramReplyExtraFromReply({ replyMarkup: markup });
    const parsed = parseTelegramReplyExtra(extra);
    assert.deepEqual(parsed.replyMarkup, markup);
  });
});
