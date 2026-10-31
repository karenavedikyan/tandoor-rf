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

describe("native bot create (Telegram external, PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_NATIVE_CREATE_TG_TOKEN_abcdefghij";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_NATIVE_BOT";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("verified external person completes wizard via inline buttons without typed yes/skip", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "native-create-staff@test.local",
      password: PASSWORD,
      fullName: "Native Staff",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "native-create-outsider@test.local",
      password: PASSWORD,
      fullName: "Outsider",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Native Staff", "+79991112201");

    const tgUserId = 88001001;
    const tgChatId = tgUserId;
    const phone = "+79991113301";
    await pool.query(
      `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Ext Native', $1)`,
      [phone],
    );
    const partyId = (
      await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1 LIMIT 1`, [phone])
    ).rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid, 'Ext Native', $2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid, 'telegram', $2, $3)`,
      [personId, String(tgUserId), String(tgChatId)],
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

    let seq = 880010010;
    assert.equal((await wh(++seq, { message: { message_id: 1, date: 1, chat: { id: tgChatId, type: "private" }, from: { id: tgUserId, is_bot: false }, text: "Создать передачу" } })).status, 200);

    assert.equal(
      (
        await wh(++seq, {
          message: {
            message_id: 2,
            date: 2,
            chat: { id: tgChatId, type: "private" },
            from: { id: tgUserId, is_bot: false },
            text: "Ключи от склада",
          },
        })
      ).status,
      200,
    );

    const draftRow = await poolAfter.query<{ id: string; payload: { revision: number } }>(
      `SELECT id::text, payload FROM tt_external_request_drafts
       WHERE messenger_chat_id LIKE 'native:ext:%' AND confirmed_transfer_id IS NULL`,
    );
    assert.equal(draftRow.rowCount, 1);
    const draftId = draftRow.rows[0]!.id;
    const rev = Number(draftRow.rows[0]!.payload.revision ?? 1);

    assert.equal(
      (
        await wh(++seq, {
          callback_query: {
            id: "cb-skip-photo",
            from: { id: tgUserId, is_bot: false },
            message: { chat: { id: tgChatId, type: "private" } },
            data: buildNativeCreateCallback("photo_skip", draftId, rev),
          },
        })
      ).status,
      200,
    );

    assert.equal(
      (
        await wh(++seq, {
          message: {
            message_id: 3,
            date: 3,
            chat: { id: tgChatId, type: "private" },
            from: { id: tgUserId, is_bot: false },
            text: "—",
          },
        })
      ).status,
      200,
    );

    const draftAfterComment = await poolAfter.query<{ step: string; payload: { revision: number; eligibleRecipients?: unknown[] } }>(
      `SELECT step, payload FROM tt_external_request_drafts WHERE id=$1::uuid`,
      [draftId],
    );
    assert.equal(draftAfterComment.rows[0]!.step, "recipient");
    assert.ok((draftAfterComment.rows[0]!.payload.eligibleRecipients?.length ?? 0) >= 1);
    const rev2 = Number(draftAfterComment.rows[0]!.payload.revision);

    assert.equal(
      (
        await wh(++seq, {
          callback_query: {
            id: "cb-pick-recipient",
            from: { id: tgUserId, is_bot: false },
            message: { chat: { id: tgChatId, type: "private" } },
            data: buildNativeCreateCallback("recipient", draftId, rev2, "0"),
          },
        })
      ).status,
      200,
    );

    const draftDue = await poolAfter.query<{ step: string; payload: { revision: number } }>(
      `SELECT step, payload FROM tt_external_request_drafts WHERE id=$1::uuid`,
      [draftId],
    );
    assert.equal(draftDue.rows[0]!.step, "due");
    const rev3 = Number(draftDue.rows[0]!.payload.revision);

    assert.equal(
      (
        await wh(++seq, {
          callback_query: {
            id: "cb-due",
            from: { id: tgUserId, is_bot: false },
            message: { chat: { id: tgChatId, type: "private" } },
            data: buildNativeCreateCallback("due", draftId, rev3, "t"),
          },
        })
      ).status,
      200,
    );

    const draftSummary = await poolAfter.query<{ step: string; payload: { revision: number } }>(
      `SELECT step, payload FROM tt_external_request_drafts WHERE id=$1::uuid`,
      [draftId],
    );
    assert.equal(draftSummary.rows[0]!.step, "summary");
    const rev4 = Number(draftSummary.rows[0]!.payload.revision);

    const beforeTransfers = await poolAfter.query(`SELECT COUNT(*)::int AS c FROM tt_transfers`);
    assert.equal(
      (
        await wh(++seq, {
          callback_query: {
            id: "cb-confirm",
            from: { id: tgUserId, is_bot: false },
            message: { chat: { id: tgChatId, type: "private" } },
            data: buildNativeCreateCallback("confirm", draftId, rev4),
          },
        })
      ).status,
      200,
    );
    const afterTransfers = await poolAfter.query(`SELECT COUNT(*)::int AS c FROM tt_transfers`);
    assert.equal(afterTransfers.rows[0]!.c, beforeTransfers.rows[0]!.c + 1);
    const transfer = await poolAfter.query<{ holder_party_id: string; pending_party_id: string }>(
      `SELECT holder_party_id::text, pending_party_id::text FROM tt_transfers ORDER BY created_at DESC LIMIT 1`,
    );
    assert.equal(transfer.rows[0]!.holder_party_id, partyId);
    assert.ok(transfer.rows[0]!.pending_party_id);
  });
});
