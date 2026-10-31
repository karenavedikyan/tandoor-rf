import test from "node:test";
import assert from "node:assert/strict";
import { parseTelegramWebhookUpdate } from "../../src/tanbot-telegram/update-parse";

function callback(chat: { id: number; type: string } | null, data = "hcode_test") {
  return { update_id: 70001, callback_query: {
    id: "synthetic-private-callback", data, from: { id: 885501, is_bot: false },
    ...(chat ? { message: { message_id: 1, chat } } : { inline_message_id: "synthetic-inline" }),
  } };
}
test("independent Telegram callback: valid own private chat remains supported", () => {
  const parsed = parseTelegramWebhookUpdate(callback({ id: 885501, type: "private" }));
  assert.equal(parsed.ok, true);
});
test("independent Telegram callback: group can never become a destination for a code", () => {
  for (const type of ["group", "supergroup", "channel"]) {
    assert.equal(parseTelegramWebhookUpdate(callback({ id: -885501, type })).ok, false);
  }
});
test("independent Telegram callback: a private chat for another identity is rejected", () => {
  assert.equal(parseTelegramWebhookUpdate(callback({ id: 885599, type: "private" })).ok, false);
});
test("independent Telegram callback: absent private chat context is rejected, not guessed", () => {
  assert.equal(parseTelegramWebhookUpdate(callback(null)).ok, false);
});
test("independent Telegram callback: oversized payload is rejected, never truncated into a different action", () => {
  assert.equal(parseTelegramWebhookUpdate(callback({ id: 885501, type: "private" }, "я".repeat(33))).ok, false);
  assert.equal(parseTelegramWebhookUpdate(callback({ id: 885501, type: "private" }, "x".repeat(65))).ok, false);
});
