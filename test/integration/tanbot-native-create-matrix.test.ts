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
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";

describe("native bot create matrix (PostgreSQL HTTP)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_NATIVE_MATRIX_TG";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_NATIVE_MATRIX";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = "SYNTH_NATIVE_MATRIX_MAX_TOKEN";
    process.env.TANBOT_MAX_EXPECTED_USERNAME = "id231100522180_bot";
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

  it("Telegram linked staff starts native staff draft", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "native-matrix-staff-tg@test.local",
      password: PASSWORD,
      fullName: "Matrix Staff TG",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    await ensurePartyForUserOnWrite(pool, staff.id, "Matrix Staff TG", "+79994445501");
    const tgUserId = 88004001;
    await pool.query(
      `INSERT INTO tanbot_telegram_accounts (user_id, telegram_user_id, telegram_chat_id, notifications_enabled)
       VALUES ($1::uuid, $2, $3, TRUE)`,
      [staff.id, tgUserId, tgUserId],
    );
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const poolAfter = getPool();
    assert.ok(poolAfter);
    const res = await request(app)
      .post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: 880040010,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: tgUserId, type: "private" },
          from: { id: tgUserId, is_bot: false },
          text: "Создать передачу",
        },
      });
    assert.equal(res.status, 200);
    const draft = await poolAfter.query(
      `SELECT step FROM tt_external_request_drafts WHERE messenger_chat_id = $1`,
      [`native:staff:telegram:${tgUserId}`],
    );
    assert.equal(draft.rowCount, 1);
    assert.equal(draft.rows[0]!.step, "item");
  });

  it("MAX external wizard accepts dialog chat_id different from user_id", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "native-matrix-staff@test.local",
      password: PASSWORD,
      fullName: "Matrix Staff",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Matrix Staff", "+79992223301");

    const maxUserId = 77002001;
    const maxDialogChatId = 88002099;
    assert.notEqual(maxDialogChatId, maxUserId);
    const phone = "+79992224401";
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Max Ext', $1)`, [
      phone,
    ]);
    const partyId = (
      await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [phone])
    ).rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'Max Ext',$2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid,'max',$2,$3)`,
      [personId, String(maxUserId), String(maxDialogChatId)],
    );

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const poolAfter = getPool();
    assert.ok(poolAfter);

    const maxWh = (ts: number, body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-max/webhook")
        .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
        .send(body);

    const msg = (timestamp: number, text: string, mid: string) => ({
      update_type: "message_created",
      timestamp,
      message: {
        sender: { user_id: maxUserId, is_bot: false, first_name: "Ext" },
        recipient: { chat_id: maxDialogChatId, chat_type: "dialog" },
        body: { text, mid },
      },
    });

    assert.equal((await maxWh(1001, msg(1001, "Создать передачу", "m1"))).status, 200);
    assert.equal((await maxWh(1002, msg(1002, "Коробка документов", "m2"))).status, 200);

    const draft = await poolAfter.query<{ id: string; payload: { revision: number } }>(
      `SELECT id::text, payload FROM tt_external_request_drafts WHERE messenger_chat_id LIKE 'native:ext:max:%'`,
    );
    assert.equal(draft.rowCount, 1);
    const draftId = draft.rows[0]!.id;
    let rev = Number(draft.rows[0]!.payload.revision);

    const cb = (payload: string) => ({
      update_type: "message_callback",
      timestamp: ++rev,
      callback: { callback_id: `cb-${rev}`, payload, user: { user_id: maxUserId, is_bot: false } },
      message: { recipient: { chat_id: maxDialogChatId, chat_type: "dialog" } },
    });

    assert.equal((await maxWh(1003, cb(buildNativeCreateCallback("photo_skip", draftId, rev)!))).status, 200);
    const afterSkip = await poolAfter.query<{ payload: { revision: number } }>(
      `SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`,
      [draftId],
    );
    rev = Number(afterSkip.rows[0]!.payload.revision);
    assert.equal((await maxWh(1004, cb(buildNativeCreateCallback("comment_skip", draftId, rev)!))).status, 200);

    const afterComment = await poolAfter.query<{ step: string; payload: { revision: number } }>(
      `SELECT step, payload FROM tt_external_request_drafts WHERE id=$1::uuid`,
      [draftId],
    );
    assert.equal(afterComment.rows[0]!.step, "recipient");
    rev = Number(afterComment.rows[0]!.payload.revision);
    assert.equal((await maxWh(1005, msg(1005, "+79992223301", "m3"))).status, 200);
    assert.equal((await maxWh(1006, msg(1006, "Получатель Matrix MAX", "m4"))).status, 200);

    const afterRec = await poolAfter.query<{ step: string; payload: { revision: number } }>(
      `SELECT step, payload FROM tt_external_request_drafts WHERE id=$1::uuid`,
      [draftId],
    );
    rev = Number(afterRec.rows[0]!.payload.revision);
    assert.equal((await maxWh(1006, cb(buildNativeCreateCallback("due", draftId, rev, "n")!))).status, 200);

    const afterDue = await poolAfter.query<{ step: string; payload: { revision: number } }>(
      `SELECT step, payload FROM tt_external_request_drafts WHERE id=$1::uuid`,
      [draftId],
    );
    rev = Number(afterDue.rows[0]!.payload.revision);
    const before = await poolAfter.query(`SELECT COUNT(*)::int AS c FROM tt_transfers`);
    assert.equal((await maxWh(1007, cb(buildNativeCreateCallback("confirm", draftId, rev)!))).status, 200);
    const after = await poolAfter.query(`SELECT COUNT(*)::int AS c FROM tt_transfers`);
    assert.equal(after.rows[0]!.c, before.rows[0]!.c + 1);
  });

  it("MAX group chat_type does not create native draft", async () => {
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const poolAfter = getPool();
    assert.ok(poolAfter);

    const maxUserId = 77003001;
    const res = await request(app)
      .post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
      .send({
        update_type: "message_created",
        timestamp: 2001,
        message: {
          sender: { user_id: maxUserId, is_bot: false },
          recipient: { chat_id: 99003001, chat_type: "group" },
          body: { text: "Создать передачу", mid: "g1" },
        },
      });
    assert.equal(res.status, 200);
    const drafts = await poolAfter.query(
      `SELECT COUNT(*)::int AS c FROM tt_external_request_drafts
       WHERE messenger_chat_id = $1`,
      [`native:ext:max:${99003001}`],
    );
    assert.equal(drafts.rows[0]!.c, 0);
  });

  it("concurrent confirm creates one transfer", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "native-matrix-staff2@test.local",
      password: PASSWORD,
      fullName: "Matrix Staff 2",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Matrix Staff 2", "+79993323301");

    const tgUserId = 88003001;
    const phone = "+79993324401";
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Conc Ext', $1)`, [
      phone,
    ]);
    const partyId = (
      await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [phone])
    ).rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'Conc Ext',$2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid,'telegram',$2,$3)`,
      [personId, String(tgUserId), String(tgUserId)],
    );

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const poolAfter = getPool();
    assert.ok(poolAfter);

    const wh = (updateId: number, body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
        .send({ update_id: updateId, ...body });

    let seq = 880030010;
    const priv = { chat: { id: tgUserId, type: "private" }, from: { id: tgUserId, is_bot: false } };
    assert.equal((await wh(++seq, { message: { message_id: 1, date: 1, ...priv, text: "Создать передачу" } })).status, 200);
    assert.equal((await wh(++seq, { message: { message_id: 2, date: 2, ...priv, text: "Пакет" } })).status, 200);

    const draftRow = await poolAfter.query<{ id: string; payload: { revision: number } }>(
      `SELECT id::text, payload FROM tt_external_request_drafts
       WHERE messenger_chat_id = $1 AND confirmed_transfer_id IS NULL`,
      [`native:ext:telegram:${tgUserId}`],
    );
    const draftId = draftRow.rows[0]!.id;
    let rev = Number(draftRow.rows[0]!.payload.revision);

    const cb = (data: string) => ({
      callback_query: {
        id: `cb-${data}`,
        from: { id: tgUserId, is_bot: false },
        message: { chat: { id: tgUserId, type: "private" } },
        data,
      },
    });

    await wh(++seq, cb(buildNativeCreateCallback("photo_skip", draftId, rev)!));
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );
    await wh(++seq, cb(buildNativeCreateCallback("comment_skip", draftId, rev)!));
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );
    assert.equal((await wh(++seq, { message: { message_id: 3, date: 3, ...priv, text: "+79993323301" } })).status, 200);
    assert.equal((await wh(++seq, { message: { message_id: 4, date: 4, ...priv, text: "Получатель Matrix Telegram" } })).status, 200);
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );
    await wh(++seq, cb(buildNativeCreateCallback("due", draftId, rev, "t")!));
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );

    const confirmData = buildNativeCreateCallback("confirm", draftId, rev)!;
    const before = await poolAfter.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tt_transfers WHERE holder_party_id = $1::uuid`,
      [partyId],
    );
    await Promise.all([
      wh(++seq, cb(confirmData)),
      wh(++seq + 1000, cb(confirmData)),
    ]);
    const after = await poolAfter.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tt_transfers WHERE holder_party_id = $1::uuid`,
      [partyId],
    );
    assert.equal(after.rows[0]!.c, before.rows[0]!.c + 1);
  });
});
