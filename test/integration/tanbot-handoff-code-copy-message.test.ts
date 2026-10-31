import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { buildHandoffGenCallback } from "../../src/tanbot/handoff-code-bot-service";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { parseTelegramReplyExtra } from "../../src/tanbot/webhook-reply-extra";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

function setPilotEnv(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
  process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
  process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
  process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

describe("handoff code copy-only follow-up message", { concurrency: false }, () => {
  before(async () => {
    setPilotEnv();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("telegram: primary ok + copy fail retries copy only then marks delivered", async () => {
    const app = await loadApp();
    const pending = await createTestUser({
      databaseUrl,
      email: "copy-msg-pending@test.local",
      password: PASSWORD,
      fullName: "Copy Pending",
      role: "manager",
    });
    const holder = await createTestUser({
      databaseUrl,
      email: "copy-msg-holder@test.local",
      password: PASSWORD,
      fullName: "Copy Holder",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    const publicCode = "P-COPY-1";
    let tgUserId = 901234;
    try {
      const holderParty = await ensurePartyForUserOnWrite(client, holder.id, "Holder", null);
      const pendingParty = await ensurePartyForUserOnWrite(client, pending.id, "Pending", null);
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ('tt-copy-1',$1,'Box','waiting',FALSE,$2,$2,$3,$3,1,1)`,
        [publicCode, holderParty.id, pendingParty.id],
      );
      await client.query(
        `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled, linked_at)
         VALUES ($1::uuid,$2,$2,TRUE,NOW())`,
        [pending.id, tgUserId],
      );
    } finally {
      client.release();
    }

    const updateId = 880001;
    const res = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: updateId,
        callback_query: {
          id: "cb-copy-1",
          from: { id: tgUserId, is_bot: false, first_name: "P" },
          message: { chat: { id: tgUserId, type: "private" }, message_id: 1 },
          data: buildHandoffGenCallback(publicCode),
        },
      });
    assert.equal(res.status, 200);

    const stored = await pool.query<{ reply_extra: unknown; reply_delivered_at: Date | null }>(
      `SELECT reply_extra, reply_delivered_at FROM tanbot_telegram_update_dedup WHERE update_id = $1`,
      [updateId],
    );
    const extra = parseTelegramReplyExtra(stored.rows[0]?.reply_extra);
    assert.match(extra.copyOnlyCode ?? "", /^\d{6}$/);
    assert.equal(stored.rows[0]?.reply_delivered_at, null);

    let sendMessageCalls = 0;
    const transport: TelegramDeliveryTransport = async ({ method, body }) => {
      if (method === "sendMessage") {
        sendMessageCalls += 1;
        if (sendMessageCalls === 1) {
          assert.match(String(body.text), /Код приёма/i);
          assert.ok(String(body.text).includes(extra.copyOnlyCode ?? ""));
          return { ok: true, result: {} };
        }
        assert.equal(String(body.text), extra.copyOnlyCode);
        return { ok: false, code: "HTTP_ERROR", message: "fail copy", retryable: true };
      }
      return { ok: true, result: {} };
    };

    const cfg = loadTanbotTelegramStage2Config();
    assert.equal(cfg.ok, true);
    if (!cfg.ok) return;

    await deliverTelegramWebhookReply(pool, cfg.config, transport, updateId, {
      chatId: BigInt(tgUserId),
      text: "placeholder",
    });

    const mid = await pool.query<{ reply_extra: unknown; reply_delivered_at: Date | null }>(
      `SELECT reply_extra, reply_delivered_at FROM tanbot_telegram_update_dedup WHERE update_id = $1`,
      [updateId],
    );
    const midExtra = parseTelegramReplyExtra(mid.rows[0]?.reply_extra);
    assert.equal(midExtra.delivery?.primary, true);
    assert.notEqual(midExtra.delivery?.copyOnly, true);
    assert.equal(mid.rows[0]?.reply_delivered_at, null);

    sendMessageCalls = 0;
    const transport2: TelegramDeliveryTransport = async ({ method, body }) => {
      if (method === "sendMessage") {
        sendMessageCalls += 1;
        assert.equal(sendMessageCalls, 1);
        assert.equal(String(body.text), extra.copyOnlyCode);
        assert.equal(body.reply_markup, undefined);
        return { ok: true, result: {} };
      }
      return { ok: true, result: {} };
    };

    const retry = await processUndeliveredTelegramWebhookReplies(pool, cfg.config, transport2, {
      deliveryEnabled: true,
      limit: 5,
    });
    assert.equal(retry.attempted, 1);
    assert.equal(retry.delivered, 1);

    const done = await pool.query<{ reply_delivered_at: Date | null }>(
      `SELECT reply_delivered_at FROM tanbot_telegram_update_dedup WHERE update_id = $1`,
      [updateId],
    );
    assert.ok(done.rows[0]?.reply_delivered_at);

    const codesBefore = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes hc JOIN tt_transfers t ON t.id = hc.transfer_id WHERE t.public_code = $1`,
      [publicCode],
    );
    const replay = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: updateId,
        callback_query: {
          id: "cb-copy-1-replay",
          from: { id: tgUserId, is_bot: false, first_name: "P" },
          message: { chat: { id: tgUserId, type: "private" }, message_id: 1 },
          data: buildHandoffGenCallback(publicCode),
        },
      });
    assert.equal(replay.status, 200);
    const codesAfter = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tt_handoff_codes hc JOIN tt_transfers t ON t.id = hc.transfer_id WHERE t.public_code = $1`,
      [publicCode],
    );
    assert.equal(codesAfter.rows[0]!.c, codesBefore.rows[0]!.c, "replay must not issue another code");
  });
});
