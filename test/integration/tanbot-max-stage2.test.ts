import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { createRecordingMaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import { hashLinkStartToken } from "../../src/tanbot-max/link-tokens";
import { processTanbotMaxNotificationOutbox } from "../../src/tanbot-max/outbox-worker";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
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
const SYNTH_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";
const WEBHOOK_SECRET = "test-max-webhook-secret-min16";
const LINK_PEPPER = "test-max-link-pepper-min-16-chars";
const databaseUrl = getIntegrationDatabaseUrl();

function setMaxStage2Env(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_MAX_ENABLED = "true";
  process.env.TANBOT_MAX_BOT_TOKEN = SYNTH_TOKEN;
  process.env.TANBOT_MAX_EXPECTED_USERNAME = "id231100522180_bot";
  process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
  process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = LINK_PEPPER;
  process.env.TANBOT_MAX_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_MAX_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TANBOT_MAX_DELIVERY_ENABLED = "false";
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

describe("tanbot max stage2", { concurrency: false }, () => {
  before(async () => {
    setMaxStage2Env();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("link flow: start → bot_started webhook → LK confirm → linked", async () => {
    await createTestUser({
      databaseUrl,
      email: "max-link@test.local",
      password: PASSWORD,
      fullName: "Max Link User",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("max-link@test.local", app);

    const start = await request(app)
      .post("/api/profile/tanbot/max/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(start.status, 200, start.text);
    const deepLink: string = start.body.deepLink;
    assert.match(deepLink, /^https:\/\/max\.ru\//);
    const token = new URL(deepLink).searchParams.get("start");
    assert.ok(token);

    const webhookUpdate = {
      update_type: "bot_started",
      timestamp: 1737500130100,
      chat_id: 900001,
      user: { user_id: 900001, is_bot: false, first_name: "Max", username: "max_user" },
      payload: token,
    };

    const wh = await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", WEBHOOK_SECRET)
      .send(webhookUpdate);
    assert.equal(wh.status, 200, wh.text);

    const statusBefore = await request(app)
      .get("/api/profile/tanbot/max")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.ok(statusBefore.body.pendingConfirmation);
    assert.equal(statusBefore.body.linked, false);

    const confirm = await request(app)
      .post("/api/profile/tanbot/max/link/confirm")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({
        attemptId: statusBefore.body.pendingConfirmation.attemptId,
        enableNotifications: true,
      });
    assert.equal(confirm.status, 200, confirm.text);

    const statusAfter = await request(app)
      .get("/api/profile/tanbot/max")
      .set({ Origin: ORIGIN, Cookie: cookie });
    assert.equal(statusAfter.body.linked, true);
  });

  it("rejects webhook without secret", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post("/api/tanbot-max/webhook")
      .send({ update_type: "bot_started", timestamp: 1, chat_id: 1, user: { user_id: 1 } });
    assert.equal(res.status, 403);
  });

  it("max outbox delivers via recording transport", async () => {
    const holderUser = await createTestUser({
      databaseUrl,
      email: "max-holder@test.local",
      password: PASSWORD,
      fullName: "Max Holder",
      role: "manager",
    });
    const recipientUser = await createTestUser({
      databaseUrl,
      email: "max-recipient@test.local",
      password: PASSWORD,
      fullName: "Max Recipient",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    const transferId = "tt-max-1";
    try {
      await client.query("BEGIN");
      const holderParty = await ensurePartyForUserOnWrite(client, holderUser.id, "H", "+79990001111");
      const pendingParty = await ensurePartyForUserOnWrite(client, recipientUser.id, "R", "+79990002222");
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id, handoff_version, row_version)
         VALUES ($1, 'MAX1', 'Max item', 'waiting', $2, $2, $3, 1, 1)`,
        [transferId, holderParty.id, pendingParty.id],
      );
      await client.query(
        `INSERT INTO tanbot_max_accounts (user_id, max_user_id, max_chat_id, notifications_enabled)
         VALUES ($1::uuid, 888001, 888001, TRUE)`,
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
        "max handoff",
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
    const loaded = loadTanbotMaxStage2Config();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;

    const sink = { calls: [] as Array<{ userId: string; text: string }> };
    const transport = createRecordingMaxDeliveryTransport(sink);
    const result = await processTanbotMaxNotificationOutbox(pool, loaded.config, transport, {
      deliveryEnabled: true,
    });
    assert.equal(result.sent, 1);
    assert.match(sink.calls[0]!.text, /MAX1/);
  });

  it("expired token not accepted on bot_started", async () => {
    const pool = getPool();
    assert.ok(pool);
    const user = await createTestUser({
      databaseUrl,
      email: "max-exp@test.local",
      password: PASSWORD,
      fullName: "Exp",
      role: "manager",
    });
    const fakeToken = "expiredmaxtoken12";
    await pool.query(
      `INSERT INTO tanbot_max_link_attempts (user_id, token_hash, expires_at)
       VALUES ($1::uuid, $2, NOW() - interval '1 hour')`,
      [user.id, hashLinkStartToken(fakeToken, LINK_PEPPER)],
    );
    const app = await loadApp();
    const res = await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", WEBHOOK_SECRET)
      .send({
        update_type: "bot_started",
        timestamp: 2,
        chat_id: 9010,
        user: { user_id: 9010, is_bot: false },
        payload: fakeToken,
      });
    assert.equal(res.status, 200);
  });
});
