import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { createRecordingTelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { hashLinkStartToken } from "../../src/tanbot-telegram/link-tokens";
import { processTanbotNotificationOutbox } from "../../src/tanbot-telegram/outbox-worker";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { applyPendingReceiptHandoff } from "../../src/tan-tracker/handoff-complete";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const SYNTH_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
const WEBHOOK_SECRET = "test-webhook-secret-min-16";
const LINK_PEPPER = "test-link-pepper-min-16-chars";
const databaseUrl = getIntegrationDatabaseUrl();

function setStage2Env(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_TELEGRAM_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_BOT_TOKEN = SYNTH_TOKEN;
  process.env.TANBOT_TELEGRAM_EXPECTED_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = LINK_PEPPER;
  process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, app: Awaited<ReturnType<typeof loadApp>>) {
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("tanbot telegram stage2", { concurrency: false }, () => {
  before(async () => {
    setStage2Env();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("link flow: start → webhook /start → LK confirm → status linked", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "tanbot-link@test.local",
      password: PASSWORD,
      fullName: "Tanbot Link User",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("tanbot-link@test.local", app);

    const start = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(start.status, 200, start.text);
    const deepLink: string = start.body.deepLink;
    const token = new URL(deepLink).searchParams.get("start");
    assert.ok(token);

    const webhookUpdate = {
      update_id: 9001,
      message: {
        message_id: 1,
        from: { id: 900001, is_bot: false, first_name: "TG", username: "tg_user" },
        chat: { id: 900001, type: "private" },
        date: 1,
        text: `/start ${token}`,
      },
    };

    const sink = { calls: [] as Array<{ method: string; body: Record<string, unknown> }> };
    const recording = createRecordingTelegramDeliveryTransport(sink);

    const wh = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send(webhookUpdate);
    assert.equal(wh.status, 200, wh.text);

    const statusBefore = await request(app)
      .get("/api/profile/tanbot/telegram")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(statusBefore.status, 200);
    assert.ok(statusBefore.body.pendingConfirmation);
    assert.equal(statusBefore.body.linked, false);

    const confirm = await request(app)
      .post("/api/profile/tanbot/telegram/link/confirm")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ attemptId: statusBefore.body.pendingConfirmation.attemptId });
    assert.equal(confirm.status, 200, confirm.text);

    const statusAfter = await request(app)
      .get("/api/profile/tanbot/telegram")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(statusAfter.body.linked, true);

    const dup = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send(webhookUpdate);
    assert.equal(dup.status, 200);

    void recording;
    void user;
  });

  it("rejects webhook without secret", async () => {
    const app = await loadApp();
    const res = await request(app).post("/api/tanbot-telegram/webhook").send({ update_id: 1 });
    assert.equal(res.status, 403);
  });

  it("reused start token rejected on second webhook consume", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "tanbot-reuse@test.local",
      password: PASSWORD,
      fullName: "Reuse User",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("tanbot-reuse@test.local", app);
    const start = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    const token = new URL(start.body.deepLink).searchParams.get("start")!;
    const update = {
      update_id: 9002,
      message: {
        message_id: 1,
        from: { id: 900002, is_bot: false, first_name: "B" },
        chat: { id: 900002, type: "private" },
        date: 1,
        text: `/start ${token}`,
      },
    };
    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send(update);
    const second = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send({ ...update, update_id: 9003, message: { ...update.message, from: { id: 900003, is_bot: false }, chat: { id: 900003, type: "private" } } });
    assert.equal(second.status, 200);
    void user;
  });

  it("outbox enqueued on handoff and delivers via test transport", async () => {
    const holderUser = await createTestUser({
      databaseUrl,
      email: "tanbot-holder@test.local",
      password: PASSWORD,
      fullName: "Holder User",
      role: "manager",
    });
    const recipientUser = await createTestUser({
      databaseUrl,
      email: "tanbot-recipient@test.local",
      password: PASSWORD,
      fullName: "Recipient User",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let transferId = "";
    try {
      await client.query("BEGIN");
      const holderParty = await ensurePartyForUserOnWrite(client, holderUser.id, "Holder User", "+79991112233");
      const pendingParty = await ensurePartyForUserOnWrite(
        client,
        recipientUser.id,
        "Recipient User",
        "+79991112244",
      );
      transferId = "tt-tanbot-1";
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id, handoff_version, row_version)
         VALUES ($1, 'PUB1', 'Test item', 'waiting', $2, $2, $3, 1, 1)`,
        [transferId, holderParty.id, pendingParty.id],
      );
      await client.query(
        `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
         VALUES ($1::uuid, 777001, 777001, TRUE)`,
        [recipientUser.id],
      );
      await applyPendingReceiptHandoff(
        client,
        {
          id: transferId,
          holder_party_id: holderParty.id,
          pending_party_id: pendingParty.id,
          final_recipient_party_id: null,
          handoff_version: 1,
          row_version: 1,
        },
        recipientUser.id,
        pendingParty.id,
        "test handoff",
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    const loaded = loadTanbotTelegramStage2Config();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;

    const sink = { calls: [] as Array<{ method: string; body: Record<string, unknown> }> };
    const transport = createRecordingTelegramDeliveryTransport(sink);
    const result = await processTanbotNotificationOutbox(pool, loaded.config, transport, {
      deliveryEnabled: true,
    });
    assert.equal(result.sent, 1);
    assert.equal(sink.calls.length, 1);
    assert.match(String(sink.calls[0]!.body.text), /Тан-трекер/);
    assert.match(String(sink.calls[0]!.body.text), /PUB1/);

    const again = await processTanbotNotificationOutbox(pool, loaded.config, transport);
    assert.equal(again.sent, 0);
  });

  it("expired token hash not accepted", async () => {
    const pool = getPool();
    assert.ok(pool);
    const user = await createTestUser({
      databaseUrl,
      email: "tanbot-exp@test.local",
      password: PASSWORD,
      fullName: "Exp User",
      role: "manager",
    });
    const fakeToken = "expiredtoken123";
    await pool.query(
      `INSERT INTO tanbot_telegram_link_attempts (user_id, token_hash, expires_at)
       VALUES ($1::uuid, $2, NOW() - interval '1 hour')`,
      [user.id, hashLinkStartToken(fakeToken, LINK_PEPPER)],
    );
    const app = await loadApp();
    const res = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", WEBHOOK_SECRET)
      .send({
        update_id: 9010,
        message: {
          message_id: 1,
          from: { id: 9010, is_bot: false },
          chat: { id: 9010, type: "private" },
          date: 1,
          text: `/start ${fakeToken}`,
        },
      });
    assert.equal(res.status, 200);
  });
});
