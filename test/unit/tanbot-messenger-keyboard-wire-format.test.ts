import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withTransaction } from "../../src/access/db";
import { getPool, resetPoolForTests } from "../../src/db/pool";
import {
  buildMaxSendMessagePayload,
  createRecordingMaxDeliveryTransport,
} from "../../src/tanbot-max/delivery-transport";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { claimMaxUpdate } from "../../src/tanbot-max/webhook-inbox";
import {
  buildTelegramSendMessagePayload,
  deliverTelegramWebhookReply,
} from "../../src/tanbot-telegram/webhook-reply-delivery";
import {
  maxReplyExtraFromReply,
  parseMaxReplyExtra,
  parseTelegramReplyExtra,
  telegramReplyExtraFromReply,
} from "../../src/tanbot/webhook-reply-extra";
import { buildHandoffGenCallback } from "../../src/tanbot/handoff-code-bot-service";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";

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
      { query: async () => ({}) } as never,
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

  it("max handler persists request_contact extra and retry delivery emits HTTP JSON", async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";
    process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
    process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "test-max-link-pepper-min-16-chars";
    process.env.TANBOT_MAX_WEBHOOK_SECRET = "test-max-webhook-secret-min16";
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
    process.env.APP_ORIGIN = ORIGIN;
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);

    const cfg = loadTanbotMaxStage2Config();
    assert.equal(cfg.ok, true);
    if (!cfg.ok) return;

    const dedupKey = "wire-test-max-er-start";
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tanbot_max_update_dedup (dedup_key, status, reply_user_id, reply_text, reply_extra)
         VALUES ($1, 'committed', '1001', 'Подтвердите номер', $2::jsonb)
         ON CONFLICT (dedup_key) DO UPDATE SET reply_extra = EXCLUDED.reply_extra`,
        [
          dedupKey,
          JSON.stringify(
            maxReplyExtraFromReply({
              inlineButtons: [[{ type: "request_contact", text: "Отправить мой номер" }]],
            }),
          ),
        ],
      );
    });

    const claim = await withTransaction((client) => claimMaxUpdate(client, dedupKey));
    assert.equal(claim.kind, "resend");
    if (claim.kind !== "resend") return;
    const parsed = parseMaxReplyExtra(
      maxReplyExtraFromReply({ inlineButtons: claim.reply.inlineButtons ?? [] }),
    );
    assert.deepEqual(parsed.inlineButtons?.[0]?.[0], {
      type: "request_contact",
      text: "Отправить мой номер",
    });

    const sink = { calls: [] as Array<{ text: string; inlineButtons?: unknown }> };
    const transport = createRecordingMaxDeliveryTransport(sink);
    await deliverMaxWebhookReply(pool, cfg.config, transport, dedupKey, claim.reply);
    assert.equal(sink.calls.length, 1);
    const wire = buildMaxSendMessagePayload({
      text: sink.calls[0]!.text,
      inlineButtons: sink.calls[0]!.inlineButtons as never,
    });
    assert.deepEqual(wire.attachments?.[0], {
      type: "inline_keyboard",
      payload: {
        buttons: [[{ type: "request_contact", text: "Отправить мой номер" }]],
      },
    });

    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
  });
});
