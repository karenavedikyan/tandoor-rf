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
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe("native bot photo preview delivery (Telegram, recording transport)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_PHOTO_PREVIEW_TG";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_PHOTO_BOT";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("summary photo inspect sends sendPhoto with stored telegram_file_id", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "photo-preview-staff@test.local",
      password: PASSWORD,
      fullName: "Photo Staff",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Photo Staff", "+79995556601");

    const tgUserId = 88005001;
    const phone = "+79995557701";
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Photo Ext', $1)`, [
      phone,
    ]);
    const partyId = (
      await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [phone])
    ).rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'Photo Ext',$2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid,'telegram',$2,$3)`,
      [personId, String(tgUserId), String(tgUserId)],
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/synthetic.jpg" } }), {
          status: 200,
        });
      }
      if (url.includes("/file/bot")) {
        return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      return originalFetch(input);
    };

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

    let seq = 880050010;
    const priv = { chat: { id: tgUserId, type: "private" }, from: { id: tgUserId, is_bot: false } };
    assert.equal((await wh(++seq, { message: { message_id: 1, date: 1, ...priv, text: "Создать передачу" } })).status, 200);
    assert.equal((await wh(++seq, { message: { message_id: 2, date: 2, ...priv, text: "Фото предмет" } })).status, 200);
    assert.equal(
      (
        await wh(++seq, {
          message: {
            message_id: 3,
            date: 3,
            ...priv,
            photo: [{ file_id: "synthetic-file-id-001", file_unique_id: "uniq1", width: 100, height: 100 }],
          },
        })
      ).status,
      200,
    );

    const draft = await poolAfter.query<{ id: string; payload: { revision: number } }>(
      `SELECT id::text, payload FROM tt_external_request_drafts WHERE messenger_chat_id = $1`,
      [`native:ext:telegram:${tgUserId}`],
    );
    assert.equal(draft.rowCount, 1);
    const draftId = draft.rows[0]!.id;
    let rev = Number(draft.rows[0]!.payload.revision);
    const tgChatId = tgUserId;

    const cb = (data: string) => ({
      callback_query: {
        id: `cb-${data}`,
        from: { id: tgUserId, is_bot: false },
        message: { chat: { id: tgChatId, type: "private" } },
        data,
      },
    });

    await wh(++seq, cb(buildNativeCreateCallback("photo_next", draftId, rev)!));
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await wh(++seq, cb(buildNativeCreateCallback("comment_skip", draftId, rev)!));
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    assert.equal((await wh(++seq, { message: { message_id: 4, date: 4, ...priv, text: "+79995556601" } })).status, 200);
    assert.equal((await wh(++seq, { message: { message_id: 5, date: 5, ...priv, text: "Получатель фото" } })).status, 200);
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await wh(++seq, cb(buildNativeCreateCallback("due", draftId, rev, "n")!));
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);

    const fileRow = await poolAfter.query<{ telegram_file_id: string | null }>(
      `SELECT telegram_file_id FROM tt_external_request_draft_files WHERE draft_id=$1::uuid`,
      [draftId],
    );
    assert.equal(fileRow.rows[0]?.telegram_file_id, "synthetic-file-id-001");

    const sink: Array<{ method: string; body: Record<string, unknown> }> = [];
    assert.equal((await wh(++seq, cb(buildNativeCreateCallback("photo_view", draftId, rev, "0")!))).status, 200);

    const loaded = loadTanbotTelegramStage2Config();
    assert.ok(loaded.ok);
    const transport: TelegramDeliveryTransport = async (input) => {
      sink.push({ method: input.method, body: { ...input.body } });
      return { ok: true, result: {} };
    };
    await processUndeliveredTelegramWebhookReplies(poolAfter, loaded.config, transport, { deliveryEnabled: true });

    assert.ok(sink.some((c) => c.method === "sendMessage"));
    const photoCall = sink.find((c) => c.method === "sendPhoto");
    assert.ok(photoCall, `expected sendPhoto, got ${JSON.stringify(sink.map((s) => s.method))}`);
    assert.equal(photoCall.body.photo, "synthetic-file-id-001");

    globalThis.fetch = originalFetch;
  });
});
