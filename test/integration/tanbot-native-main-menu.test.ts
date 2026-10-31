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
import { NATIVE_MAIN_MENU_ACTION_PROMPT } from "../../src/tanbot/native-create/main-menu";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";

describe("native bot main menu (MAX + Telegram)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_MAIN_MENU_TG_TOKEN_xx";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_MENU_BOT";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = "SYNTH_MAIN_MENU_MAX";
    process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
    process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "test-max-link-pepper-min-16-chars";
    process.env.TANBOT_MAX_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_MAX_WEBHOOK_SECRET = "test-max-webhook-secret-min16";
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "false";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  async function seedStaffTelegram(tgUserId: number) {
    const staff = await createTestUser({
      databaseUrl,
      email: `menu-staff-${tgUserId}@test.local`,
      password: PASSWORD,
      fullName: "Menu Staff",
      role: "manager",
    });
    const pool = getPool()!;
    await ensurePartyForUserOnWrite(pool, staff.id, "Menu Staff", "+79990007701");
    await pool.query(
      `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
       VALUES ($1::uuid, $2, $3, TRUE)`,
      [staff.id, tgUserId, tgUserId],
    );
    return staff;
  }

  async function globalCounts() {
    return (
      await getPool()!.query(`SELECT
      (SELECT count(*) FROM tt_transfers)::int transfers,
      (SELECT count(*) FROM tt_external_request_drafts)::int drafts,
      (SELECT count(*) FROM tt_handoff_codes)::int codes`)
    ).rows[0]!;
  }

  it("Telegram /start opens main menu without creating a draft", async () => {
    const tgUserId = 89001001;
    await seedStaffTelegram(tgUserId);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const before = await globalCounts();
    const res = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 890010010,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: tgUserId, type: "private" },
          from: { id: tgUserId, is_bot: false },
          text: "/start",
        },
      });
    assert.equal(res.status, 200);
    assert.match(
      (
        await getPool()!.query(`SELECT reply_text FROM tanbot_telegram_update_dedup WHERE update_id=$1`, [
          890010010,
        ])
      ).rows[0]!.reply_text,
      /^Тандор\n/u,
    );
    assert.match(
      (
        await getPool()!.query(`SELECT reply_text FROM tanbot_telegram_update_dedup WHERE update_id=$1`, [
          890010010,
        ])
      ).rows[0]!.reply_text,
      new RegExp(NATIVE_MAIN_MENU_ACTION_PROMPT),
    );
    const drafts = await getPool()!.query(`SELECT id FROM tt_external_request_drafts`);
    assert.equal(drafts.rowCount, 0);
    assert.deepEqual(await globalCounts(), before);
  });

  it("Telegram persistent keyboard is sent without inline_keyboard on main menu", async () => {
    const tgUserId = 89001002;
    await seedStaffTelegram(tgUserId);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 890010020,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: tgUserId, type: "private" },
          from: { id: tgUserId, is_bot: false },
          text: "Меню",
        },
      });
    const row = (
      await getPool()!.query<{ reply_extra: { replyMarkup?: Record<string, unknown> } }>(
        `SELECT reply_extra FROM tanbot_telegram_update_dedup WHERE update_id=$1`,
        [890010020],
      )
    ).rows[0]!;
    const markup = row.reply_extra?.replyMarkup;
    assert.ok(markup && Array.isArray(markup.keyboard), "main menu must use reply keyboard");
    assert.equal(markup.is_persistent, true);
    assert.equal((markup as { inline_keyboard?: unknown }).inline_keyboard, undefined);
  });

  it("Staff draft survives Menu and Continue restores same step and revision", async () => {
    const tgUserId = 89001003;
    await seedStaffTelegram(tgUserId);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const wh = (updateId: number, text: string) =>
      request(app)
        .post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
        .send({
          update_id: updateId,
          message: {
            message_id: updateId,
            date: updateId,
            chat: { id: tgUserId, type: "private" },
            from: { id: tgUserId, is_bot: false },
            text,
          },
        });
    await wh(890010031, "Создать передачу");
    const draft1 = (
      await getPool()!.query(`SELECT id::text, step, payload, updated_at FROM tt_external_request_drafts WHERE messenger_chat_id=$1`, [
        `native:staff:telegram:${tgUserId}`,
      ])
    ).rows[0]!;
    assert.equal(draft1.step, "item");
    const rev1 = draft1.payload.revision;
    await wh(890010032, "Меню");
    const draft2 = (
      await getPool()!.query(`SELECT id::text, step, payload, updated_at FROM tt_external_request_drafts WHERE messenger_chat_id=$1`, [
        `native:staff:telegram:${tgUserId}`,
      ])
    ).rows[0]!;
    assert.equal(draft2.id, draft1.id);
    assert.equal(draft2.step, draft1.step);
    assert.equal(draft2.payload.revision, rev1);
    assert.equal(String(draft2.updated_at), String(draft1.updated_at));
    await wh(890010033, "Продолжить оформление");
    const reply = (
      await getPool()!.query(`SELECT reply_text FROM tanbot_telegram_update_dedup WHERE update_id=$1`, [890010033])
    ).rows[0]!.reply_text;
    assert.match(reply, /Что передаёте/u);
    const draft3 = (
      await getPool()!.query(`SELECT step, payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draft1.id])
    ).rows[0]!;
    assert.equal(draft3.step, "item");
    assert.equal(draft3.payload.revision, rev1);
  });

  it("MAX plain bot_started opens menu; payload start is not replaced by menu", async () => {
    const maxUserId = 89002001;
    const maxChatId = 99002001;
    const staff = await createTestUser({
      databaseUrl,
      email: "menu-max-staff@test.local",
      password: PASSWORD,
      fullName: "Menu Max Staff",
      role: "manager",
    });
    await ensurePartyForUserOnWrite(getPool()!, staff.id, "Menu Max Staff", "+79990007702");
    await getPool()!.query(
      `INSERT INTO tanbot_max_accounts (user_id, max_user_id, max_chat_id, notifications_enabled)
       VALUES ($1::uuid, $2, $3, TRUE)`,
      [staff.id, String(maxUserId), String(maxChatId)],
    );
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const maxWh = (body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-max/webhook")
        .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
        .send(body);
    const draftsBefore = (await getPool()!.query(`SELECT count(*)::int c FROM tt_external_request_drafts`)).rows[0]!.c;
    assert.equal(
      (
        await maxWh({
          update_type: "bot_started",
          timestamp: 1,
          chat_id: maxChatId,
          user: { user_id: maxUserId, is_bot: false },
        })
      ).status,
      200,
    );
    const plain = (
      await getPool()!.query(`SELECT reply_text FROM tanbot_max_update_dedup ORDER BY received_at DESC LIMIT 1`)
    ).rows[0]!.reply_text;
    assert.match(plain, /^Тандор\n/u);
    const draftsAfter = (await getPool()!.query(`SELECT count(*)::int c FROM tt_external_request_drafts`)).rows[0]!.c;
    assert.equal(draftsAfter, draftsBefore, "plain bot_started must not create drafts");

    assert.equal(
      (
        await maxWh({
          update_type: "bot_started",
          timestamp: 2,
          chat_id: maxChatId,
          user: { user_id: maxUserId, is_bot: false },
          payload: "not-a-real-token-but-not-menu",
        })
      ).status,
      200,
    );
    const withPayload = (
      await getPool()!.query(`SELECT reply_text FROM tanbot_max_update_dedup ORDER BY received_at DESC LIMIT 1`)
    ).rows[0]!.reply_text;
    assert.doesNotMatch(withPayload, /Выберите действие/u);
  });

  it("/mystery does not trigger /my handler", async () => {
    const tgUserId = 89001004;
    await seedStaffTelegram(tgUserId);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 890010040,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: tgUserId, type: "private" },
          from: { id: tgUserId, is_bot: false },
          text: "/mystery",
        },
      });
    const text = (
      await getPool()!.query(`SELECT reply_text FROM tanbot_telegram_update_dedup WHERE update_id=$1`, [890010040])
    ).rows[0]!.reply_text;
    assert.doesNotMatch(text, /Мои передачи:/u);
  });
});
