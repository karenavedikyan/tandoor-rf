import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { claimTelegramUpdate } from "../../src/tanbot-telegram/webhook-inbox";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { withTransaction } from "../../src/access/db";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";

describe("external recipient messenger (telegram, isolated PG)", { concurrency: false }, () => {
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  let pool: Pool;
  let adminCookie = "";
  let startToken = "";
  let transferCode = "";
  let pendingPartyId = "";
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:AAH-test-token-for-integration-only";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "tandoor_test_bot";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.APP_ORIGIN = ORIGIN;
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    await createTestUser({
      databaseUrl,
      email: "ext-messenger-admin@test.local",
      password: PASSWORD,
      fullName: "Ext Admin",
      role: "admin",
    });
    const { createApp } = await import("../../src/server");
    app = createApp();
    pool = new Pool({ connectionString: databaseUrl });
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "ext-messenger-admin@test.local", password: PASSWORD });
    adminCookie = login.headers["set-cookie"]![0]!.split(";")[0]!;

    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({
        item: "External box",
        finalRecipientExternal: { name: "Внешний", phone: "+79991112233" },
      });
    assert.equal(create.status, 201, create.text);
    transferCode = create.body.publicCode;
    pendingPartyId = create.body.bootstrap.orders[0].pendingId;

    const invite = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/messenger-invite`)
      .set({ Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(invite.status, 201, invite.text);
    startToken = invite.body.startToken;
    assert.match(startToken, /^er/);
  });

  after(async () => {
    await pool.end();
    await closePool();
    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
  });

  it("public portal exposes telegram channel when configured", async () => {
    const res = await request(app).get(
      `/api/tan-tracker/public/recipient/messenger?mst=${encodeURIComponent(startToken)}`,
    );
    assert.equal(res.status, 200, res.text);
    assert.equal(typeof res.body.senderDisplayName, "string");
    assert.ok(res.body.senderDisplayName.trim().length > 0);
    assert.equal(res.body.itemTitle, "External box");
    const tg = res.body.channels.find((c: { channel: string }) => c.channel === "telegram");
    assert.ok(tg?.available);
    assert.ok(tg?.deepLink?.includes("start="));
  });

  it("telegram start + contact issues handoff code once", async () => {
    const loaded = loadTanbotTelegramStage2Config();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const cfg = loaded.config;
    const userId = 800001;
    const chatId = userId;
    const startUpdate = {
      update_id: 910001,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private" },
        from: { id: userId, is_bot: false, first_name: "Ext" },
        text: `/start ${startToken}`,
      },
    };
    const startOut = await handleTanbotTelegramUpdate(pool, cfg, startUpdate);
    assert.ok(startOut.reply?.text.includes("номер"));
    assert.ok(
      (startOut.reply?.replyMarkup as { keyboard?: Array<Array<{ request_contact?: boolean }>> })?.keyboard?.[0]?.[0]
        ?.request_contact,
    );
    const resend = await withTransaction((client) => claimTelegramUpdate(client, 910001));
    assert.equal(resend.kind, "resend");
    if (resend.kind === "resend") {
      assert.deepEqual(resend.reply.replyMarkup, startOut.reply?.replyMarkup);
    }

    const contactUpdate = {
      update_id: 910002,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private" },
        from: { id: userId, is_bot: false, first_name: "Ext" },
        contact: { phone_number: "+79991112233", user_id: userId, first_name: "Ext" },
      },
    };
    const contactOut = await handleTanbotTelegramUpdate(pool, cfg, contactUpdate);
    assert.match(contactOut.reply?.text ?? "", /\d{6}/);
    assert.deepEqual(contactOut.reply?.replyMarkup, { remove_keyboard: true });

    const contactAgain = await handleTanbotTelegramUpdate(pool, cfg, {
      ...contactUpdate,
      update_id: 910003,
      message: { ...contactUpdate.message, message_id: 3 },
    });
    assert.ok(contactAgain.reply?.text.includes("уже"));
  });

  it("rejects forwarded contact (legacy forward_date)", async () => {
    const loaded = loadTanbotTelegramStage2Config();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const cfg = loaded.config;
    const userId = 800002;
    const out = await handleTanbotTelegramUpdate(pool, cfg, {
      update_id: 910004,
      message: {
        message_id: 4,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: "private" },
        from: { id: userId, is_bot: false, first_name: "Bad" },
        forward_date: 1,
        contact: { phone_number: "+79991112233", user_id: userId, first_name: "Bad" },
      },
    });
    assert.ok(out.reply?.text.includes("Переслан"));
  });

  it("rejects forwarded contact (forward_origin)", async () => {
    const loaded = loadTanbotTelegramStage2Config();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const cfg = loaded.config;
    const userId = 800003;
    const out = await handleTanbotTelegramUpdate(pool, cfg, {
      update_id: 910005,
      message: {
        message_id: 5,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: "private" },
        from: { id: userId, is_bot: false, first_name: "Bad" },
        forward_origin: {
          type: "user",
          sender_user: { id: 700001, is_bot: false, first_name: "Other" },
          date: 1,
        },
        contact: { phone_number: "+79991112233", user_id: userId, first_name: "Bad" },
      },
    });
    assert.ok(out.reply?.text.includes("Переслан"));
  });
});
