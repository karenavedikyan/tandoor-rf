import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { withTransaction } from "../../src/access/db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import {
  buildMaxSendMessagePayload,
  createRecordingMaxDeliveryTransport,
} from "../../src/tanbot-max/delivery-transport";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { claimMaxUpdate } from "../../src/tanbot-max/webhook-inbox";
import { maxReplyExtraFromReply, parseMaxReplyExtra } from "../../src/tanbot/webhook-reply-extra";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";

describe("messenger keyboard wire format (MAX retry + PG inbox)", { concurrency: false }, () => {
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
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
  });

  after(async () => {
    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
    await closePool();
  });

  it("max handler persists request_contact extra and retry delivery emits HTTP JSON", async () => {
    const pool = getPool();
    assert.ok(pool);

    const cfg = loadTanbotMaxStage2Config();
    assert.equal(cfg.ok, true);
    if (!cfg.ok) {
      throw new Error("expected max stage2 config");
    }

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
    if (claim.kind !== "resend") {
      throw new Error("expected resend claim");
    }
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
  });
});
