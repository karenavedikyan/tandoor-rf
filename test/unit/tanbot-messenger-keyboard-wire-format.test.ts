import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMaxSendMessagePayload } from "../../src/tanbot-max/delivery-transport";
import {
  buildTelegramSendMessagePayload,
  deliverTelegramWebhookReply,
} from "../../src/tanbot-telegram/webhook-reply-delivery";
import {
  parseTelegramReplyExtra,
  telegramReplyExtraFromReply,
} from "../../src/tanbot/webhook-reply-extra";
import { buildHandoffGenCallback } from "../../src/tanbot/handoff-code-bot-service";
import { mockTelegramReplyDeliveryPool } from "../helpers/mock-telegram-reply-pool";

describe("messenger keyboard wire format (delivery + retry)", () => {
  it("telegram request_contact keyboard survives persist, resend, and sendMessage JSON", async () => {
    const markup = {
      keyboard: [[{ text: "Отправить мой номер", request_contact: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    };
    const extra = telegramReplyExtraFromReply({ replyMarkup: markup });
    const parsed = parseTelegramReplyExtra(extra);
    assert.deepEqual(parsed.replyMarkup, markup);

    const sendBody = buildTelegramSendMessagePayload({
      chatId: 42n,
      text: "Подтвердите номер",
      replyMarkup: parsed.replyMarkup,
    });
    assert.deepEqual(sendBody.reply_markup, markup);

    const captured: Array<{ method: string; body: Record<string, unknown> }> = [];
    const transport = async (call: {
      method: string;
      body: Record<string, unknown>;
    }) => {
      captured.push({ method: call.method, body: call.body });
      return { ok: true as const, result: {} };
    };

    await deliverTelegramWebhookReply(
      mockTelegramReplyDeliveryPool({
        updateId: 99,
        replyText: "Подтвердите номер",
        replyExtra: extra as Record<string, unknown>,
      }),
      {
        botToken: "t",
        requestTimeoutMs: 1000,
        maxResponseBytes: 4096,
        deliveryEnabled: true,
      } as never,
      transport as never,
      99,
      { chatId: 42n, text: "Подтвердите номер", replyMarkup: markup },
    );
    assert.equal(captured[0]?.method, "sendMessage");
    assert.deepEqual(captured[0]?.body.reply_markup, markup);
    assert.equal(captured[0]?.body.disable_web_page_preview, true);
  });

  it("telegram remove_keyboard after contact is preserved through retry extra", async () => {
    const remove = { remove_keyboard: true };
    const extra = telegramReplyExtraFromReply({ replyMarkup: remove });
    const parsed = parseTelegramReplyExtra(extra);
    const sendBody = buildTelegramSendMessagePayload({
      chatId: 7n,
      text: "Код 123456",
      replyMarkup: parsed.replyMarkup,
    });
    assert.deepEqual(sendBody.reply_markup, remove);
  });

  it("max request_contact and staff callback buttons serialize to platform-api2 payload", () => {
    const staff = buildMaxSendMessagePayload({
      text: "Выберите передачу",
      inlineButtons: [[{ type: "callback", text: "Получить код: P1", payload: buildHandoffGenCallback("P1") }]],
    });
    assert.deepEqual(staff.attachments, [
      {
        type: "inline_keyboard",
        payload: {
          buttons: [[{ type: "callback", text: "Получить код: P1", payload: buildHandoffGenCallback("P1") }]],
        },
      },
    ]);

    const contact = buildMaxSendMessagePayload({
      text: "Подтвердите номер",
      inlineButtons: [[{ type: "request_contact", text: "Отправить мой номер" }]],
    });
    assert.deepEqual(contact.attachments, [
      {
        type: "inline_keyboard",
        payload: {
          buttons: [[{ type: "request_contact", text: "Отправить мой номер" }]],
        },
      },
    ]);
  });
});
