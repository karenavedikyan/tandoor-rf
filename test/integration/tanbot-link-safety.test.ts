import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const TG_WEBHOOK_SECRET = "safety-tg-webhook-secret";
const TG_LINK_PEPPER = "safety-tg-link-pepper-min";
const TG_SYNTH_TOKEN = "123456789:SYNTH_HTTP_TANBOT_TOKEN_MARKER_abcdefghijklmnopqrst";
const MAX_SYNTH_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";
const MAX_WEBHOOK_SECRET = "safety-max-webhook-secret16";
const MAX_LINK_PEPPER = "safety-max-link-pepper-min16";
const databaseUrl = getIntegrationDatabaseUrl();

function setTelegramEnv(): void {
  setIntegrationEnv(databaseUrl, ORIGIN);
  process.env.TANBOT_TELEGRAM_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_BOT_TOKEN = TG_SYNTH_TOKEN;
  process.env.TANBOT_TELEGRAM_EXPECTED_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_IBOT";
  process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = TG_LINK_PEPPER;
  process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = TG_WEBHOOK_SECRET;
  process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
}

function setMaxEnv(): void {
  process.env.TANBOT_MAX_ENABLED = "true";
  process.env.TANBOT_MAX_BOT_TOKEN = MAX_SYNTH_TOKEN;
  process.env.TANBOT_MAX_EXPECTED_USERNAME = "id231100522180_bot";
  process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
  process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = MAX_LINK_PEPPER;
  process.env.TANBOT_MAX_WEBHOOK_ENABLED = "true";
  process.env.TANBOT_MAX_WEBHOOK_SECRET = MAX_WEBHOOK_SECRET;
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

describe("tanbot link safety", { concurrency: false }, () => {
  before(async () => {
    setTelegramEnv();
    setMaxEnv();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("telegram: concurrent same messenger for two LK users resolves to one owner without 500", async () => {
    await createTestUser({
      databaseUrl,
      email: "safe-tg-a@test.local",
      password: PASSWORD,
      fullName: "Safe TG A",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "safe-tg-b@test.local",
      password: PASSWORD,
      fullName: "Safe TG B",
      role: "manager",
    });
    const app = await loadApp();
    const cookieA = await login("safe-tg-a@test.local", app);
    const cookieB = await login("safe-tg-b@test.local", app);
    const startA = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookieA, "Content-Type": "application/json" })
      .send({});
    const startB = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookieB, "Content-Type": "application/json" })
      .send({});
    const tokenA = new URL(startA.body.deepLink).searchParams.get("start")!;
    const tokenB = new URL(startB.body.deepLink).searchParams.get("start")!;
    const tgId = 881001;
    const [whA, whB] = await Promise.all([
      request(app)
        .post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", TG_WEBHOOK_SECRET)
        .send({
          update_id: 881001,
          message: {
            message_id: 1,
            from: { id: tgId, is_bot: false, username: "race" },
            chat: { id: tgId, type: "private" },
            date: 1,
            text: `/start ${tokenA}`,
          },
        }),
      request(app)
        .post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", TG_WEBHOOK_SECRET)
        .send({
          update_id: 881002,
          message: {
            message_id: 2,
            from: { id: tgId, is_bot: false, username: "race" },
            chat: { id: tgId, type: "private" },
            date: 1,
            text: `/start ${tokenB}`,
          },
        }),
    ]);
    assert.ok(whA.status === 200 || whA.status === 409);
    assert.ok(whB.status === 200 || whB.status === 409);
    assert.notEqual(whA.status, 500);
    assert.notEqual(whB.status, 500);
    const pool = getPool()!;
    const owners = await pool.query(`SELECT user_id::text FROM tanbot_telegram_accounts WHERE telegram_user_id = $1`, [
      tgId,
    ]);
    assert.equal(owners.rowCount, 1);
  });

  it("telegram: plain /start reports linked notification state; replay preserves opt-out", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "safe-tg-plain@test.local",
      password: PASSWORD,
      fullName: "Plain TG",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("safe-tg-plain@test.local", app);
    const start = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    const token = new URL(start.body.deepLink).searchParams.get("start")!;
    const tgId = 881010;
    const linkUpdate = {
      update_id: 881010,
      message: {
        message_id: 1,
        from: { id: tgId, is_bot: false, username: "plain" },
        chat: { id: tgId, type: "private" },
        date: 1,
        text: `/start ${token}`,
      },
    };
    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", TG_WEBHOOK_SECRET)
      .send(linkUpdate);

    await request(app)
      .post("/api/profile/tanbot/telegram/notifications")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ enabled: false });

    const pool = getPool()!;
    const tgConfig = loadTanbotTelegramStage2Config();
    assert.equal(tgConfig.ok, true);
    if (!tgConfig.ok) return;
    const plain = await handleTanbotTelegramUpdate(pool, tgConfig.config, {
      update_id: 881011,
      message: {
        message_id: 2,
        from: { id: tgId, is_bot: false, username: "plain" },
        chat: { id: tgId, type: "private" },
        date: 1,
        text: "/start",
      },
    });
    assert.match(String(plain.reply?.text ?? ""), /выключены/);

    const replay = await handleTanbotTelegramUpdate(pool, tgConfig.config, {
      ...linkUpdate,
      update_id: 881012,
      message: { ...linkUpdate.message, message_id: 3 },
    });
    assert.match(String(replay.reply?.text ?? ""), /выключены/);

    const row = await pool.query(`SELECT notifications_enabled FROM tanbot_telegram_accounts WHERE user_id = $1::uuid`, [
      user.id,
    ]);
    assert.equal(row.rows[0]?.notifications_enabled, false);
  });

  it("telegram: disabled LK user cannot consume start token", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "safe-tg-disabled@test.local",
      password: PASSWORD,
      fullName: "Disabled TG",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("safe-tg-disabled@test.local", app);
    const start = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    const token = new URL(start.body.deepLink).searchParams.get("start")!;
    const pool = getPool()!;
    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1::uuid`, [user.id]);
    const wh = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", TG_WEBHOOK_SECRET)
      .send({
        update_id: 881020,
        message: {
          message_id: 1,
          from: { id: 881020, is_bot: false },
          chat: { id: 881020, type: "private" },
          date: 1,
          text: `/start ${token}`,
        },
      });
    assert.equal(wh.status, 200);
    const linked = await pool.query(`SELECT 1 FROM tanbot_telegram_accounts WHERE user_id = $1::uuid`, [user.id]);
    assert.equal(linked.rowCount, 0);
  });

  it("telegram: cannot take stopped identity owned by another user", async () => {
    const owner = await createTestUser({
      databaseUrl,
      email: "safe-tg-owner@test.local",
      password: PASSWORD,
      fullName: "Owner",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "safe-tg-thief@test.local",
      password: PASSWORD,
      fullName: "Thief",
      role: "manager",
    });
    const app = await loadApp();
    const pool = getPool()!;
    const tgId = 881030;
    await pool.query(
      `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled, stopped_at)
       VALUES ($1::uuid, $2, $2, FALSE, NOW())`,
      [owner.id, tgId],
    );
    const cookieThief = await login("safe-tg-thief@test.local", app);
    const start = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookieThief, "Content-Type": "application/json" })
      .send({});
    const token = new URL(start.body.deepLink).searchParams.get("start")!;
    const wh = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", TG_WEBHOOK_SECRET)
      .send({
        update_id: 881030,
        message: {
          message_id: 1,
          from: { id: tgId, is_bot: false },
          chat: { id: tgId, type: "private" },
          date: 1,
          text: `/start ${token}`,
        },
      });
    assert.equal(wh.status, 200);
    const owners = await pool.query(`SELECT user_id::text FROM tanbot_telegram_accounts WHERE telegram_user_id = $1`, [
      tgId,
    ]);
    assert.equal(owners.rowCount, 1);
    assert.equal(owners.rows[0]!.user_id, owner.id);
  });

  it("telegram: new link start invalidates previous token", async () => {
    await createTestUser({
      databaseUrl,
      email: "safe-tg-reissue@test.local",
      password: PASSWORD,
      fullName: "Reissue",
      role: "manager",
    });
    const app = await loadApp();
    const cookie = await login("safe-tg-reissue@test.local", app);
    const first = await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    const oldToken = new URL(first.body.deepLink).searchParams.get("start")!;
    await request(app)
      .post("/api/profile/tanbot/telegram/link/start")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    const pool = getPool()!;
    const tgConfig = loadTanbotTelegramStage2Config();
    assert.equal(tgConfig.ok, true);
    if (!tgConfig.ok) return;
    const handled = await handleTanbotTelegramUpdate(pool, tgConfig.config, {
      update_id: 881040,
      message: {
        message_id: 1,
        from: { id: 881040, is_bot: false },
        chat: { id: 881040, type: "private" },
        date: 1,
        text: `/start ${oldToken}`,
      },
    });
    assert.match(String(handled.reply?.text ?? ""), /недействительна|истекла/i);
  });

  it("max: concurrent same messenger for two LK users resolves without 500", async () => {
    await createTestUser({
      databaseUrl,
      email: "safe-max-a@test.local",
      password: PASSWORD,
      fullName: "Safe Max A",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "safe-max-b@test.local",
      password: PASSWORD,
      fullName: "Safe Max B",
      role: "manager",
    });
    const app = await loadApp();
    const cookieA = await login("safe-max-a@test.local", app);
    const cookieB = await login("safe-max-b@test.local", app);
    const startA = await request(app)
      .post("/api/profile/tanbot/max/link/start")
      .set({ Origin: ORIGIN, Cookie: cookieA, "Content-Type": "application/json" })
      .send({});
    const startB = await request(app)
      .post("/api/profile/tanbot/max/link/start")
      .set({ Origin: ORIGIN, Cookie: cookieB, "Content-Type": "application/json" })
      .send({});
    const tokenA = new URL(startA.body.deepLink).searchParams.get("start")!;
    const tokenB = new URL(startB.body.deepLink).searchParams.get("start")!;
    const maxId = 882001;
    const payload = (ts: number, token: string) => ({
      update_type: "bot_started",
      timestamp: ts,
      chat_id: maxId,
      user: { user_id: maxId, is_bot: false, first_name: "Race", username: "max_race" },
      payload: token,
    });
    const [whA, whB] = await Promise.all([
      request(app)
        .post("/api/tanbot-max/webhook")
        .set("X-Max-Bot-Api-Secret", MAX_WEBHOOK_SECRET)
        .send(payload(1737500138821, tokenA)),
      request(app)
        .post("/api/tanbot-max/webhook")
        .set("X-Max-Bot-Api-Secret", MAX_WEBHOOK_SECRET)
        .send(payload(1737500138822, tokenB)),
    ]);
    assert.notEqual(whA.status, 500);
    assert.notEqual(whB.status, 500);
    const pool = getPool()!;
    const owners = await pool.query(`SELECT user_id::text FROM tanbot_max_accounts WHERE max_user_id = $1`, [maxId]);
    assert.equal(owners.rowCount, 1);
  });
});
