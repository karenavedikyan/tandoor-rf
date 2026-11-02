import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deliverTelegramWebhookReply,
  buildTelegramSendMessagePayload,
} from "../../src/tanbot-telegram/webhook-reply-delivery";
import { parseTelegramReplyExtra } from "../../src/tanbot/webhook-reply-extra";
import { packTelegramNativeReplyMarkup, TELEGRAM_KEYBOARD_AUX_TEXT } from "../../src/tanbot/native-create/telegram-reply-markup";
import { mockTelegramReplyDeliveryPool } from "../helpers/mock-telegram-reply-pool";

describe("telegram keyboard delivery sequence", () => {
  it("packs inline plus remove into clear-then-primary delivery extra", () => {
    const packed = packTelegramNativeReplyMarkup({
      text: "Шаг",
      replyMarkup: { remove_keyboard: true },
      telegramInlineKeyboard: [[{ text: "Меню", callback_data: "nc:0:abc" }]],
    });
    assert.equal(packed.replyKeyboardClear, true);
    assert.deepEqual(packed.replyMarkup, { inline_keyboard: [[{ text: "Меню", callback_data: "nc:0:abc" }]] });
  });

  it("delivers remove_keyboard before inline primary and supports retry after clear failure", async () => {
    const inline = { inline_keyboard: [[{ text: "Далее", callback_data: "nc:6:abc:1" }]] };
    const extra = {
      replyKeyboardClear: true,
      replyMarkup: inline,
      delivery: { clearReplyKeyboard: false, primary: false },
    };
    const captured: Array<{ method: string; body: Record<string, unknown> }> = [];
    let attempts = 0;
    const transport = async (call: { method: string; body: Record<string, unknown> }) => {
      captured.push({ method: call.method, body: call.body });
      if (call.method === "sendMessage" && (call.body.reply_markup as { remove_keyboard?: boolean })?.remove_keyboard) {
        attempts += 1;
        if (attempts === 1) return { ok: false as const, code: "NETWORK", message: "fail", retryable: true };
      }
      return { ok: true as const, result: { message_id: 1 } };
    };
    const pool = mockTelegramReplyDeliveryPool({
      updateId: 501,
      replyText: "Шаг мастера",
      replyExtra: extra,
    });
    const fail = await deliverTelegramWebhookReply(
      pool,
      { botToken: "t", requestTimeoutMs: 1000, maxResponseBytes: 4096, deliveryEnabled: true } as never,
      transport as never,
      501,
      { chatId: 42n, text: "Шаг мастера", replyMarkup: inline },
    );
    assert.equal(fail?.ok, false);
    const retry = await deliverTelegramWebhookReply(
      pool,
      { botToken: "t", requestTimeoutMs: 1000, maxResponseBytes: 4096, deliveryEnabled: true } as never,
      transport as never,
      501,
      { chatId: 42n, text: "Шаг мастера", replyMarkup: inline },
    );
    assert.equal(retry?.ok, true);
    const bodies = captured.filter((c) => c.method === "sendMessage").map((c) => c.body);
    assert.deepEqual(bodies[0]?.reply_markup, { remove_keyboard: true });
    assert.equal(bodies[0]?.text, TELEGRAM_KEYBOARD_AUX_TEXT);
    assert.deepEqual(bodies.at(-1)?.reply_markup, inline);
    assert.ok(!((bodies.at(-1)?.reply_markup as { keyboard?: unknown })?.keyboard));
  });

  it("restore step follows compact inline primary", async () => {
    const home = { keyboard: [[{ text: "Создать передачу" }]], resize_keyboard: true, is_persistent: true };
    const inline = { inline_keyboard: [[{ text: "Настройки", callback_data: "nc:m:abc:1" }]] };
    const extra = {
      replyKeyboardClear: true,
      replyKeyboardRestore: home,
      replyMarkup: inline,
      delivery: { clearReplyKeyboard: true, primary: true, restoreReplyKeyboard: false },
    };
    const captured: Array<Record<string, unknown>> = [];
    const pool = mockTelegramReplyDeliveryPool({ updateId: 77, replyText: "Дополнительно", replyExtra: extra });
    await deliverTelegramWebhookReply(
      pool,
      { botToken: "t", requestTimeoutMs: 1000, maxResponseBytes: 4096, deliveryEnabled: true } as never,
      (async (call) => {
        if (call.method === "sendMessage") captured.push(call.body);
        return { ok: true as const, result: {} };
      }) as never,
      77,
      { chatId: 9n, text: "Дополнительно", replyMarkup: inline },
    );
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0]?.reply_markup, home);
    const stored = (
      await pool.query(`SELECT reply_extra FROM tanbot_telegram_update_dedup WHERE update_id=$1 FOR UPDATE`, [77])
    ).rows[0]?.reply_extra;
    assert.equal(parseTelegramReplyExtra(stored).delivery?.restoreReplyKeyboard, true);
  });
});
