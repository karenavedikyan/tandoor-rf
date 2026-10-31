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
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import { buildMaxSendMessagePayload } from "../../src/tanbot-max/delivery-transport";
import { readAttachmentBytes } from "../../src/tan-tracker/attachments";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const MIN_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8");
const PDF_A = Buffer.concat([MIN_PDF, Buffer.from("\n%A")]);
const PDF_B = Buffer.concat([MIN_PDF, Buffer.from("\n%B")]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe("native bot PDF attachments (MAX + Telegram)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_NATIVE_PDF_TG_TOKEN_abcdefghij";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_PDF_BOT";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = "SYNTH_NATIVE_PDF_MAX";
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

  async function seedTelegramExternal(tgUserId: number, phone: string) {
    const staff = await createTestUser({
      databaseUrl,
      email: `pdf-staff-${tgUserId}@test.local`,
      password: PASSWORD,
      fullName: "PDF Staff",
      role: "manager",
    });
    const pool = getPool()!;
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "PDF Staff", "+79990001101");
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'PDF Ext', $1)`, [
      phone,
    ]);
    const partyId = (await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [phone]))
      .rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'PDF Ext',$2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid,'telegram',$2,$3)`,
      [personId, String(tgUserId), String(tgUserId)],
    );
    return { staff, personId };
  }

  it("Telegram: two PDF documents get acknowledged and stored with exact bytes", async () => {
    const tgUserId = 88100101;
    await seedTelegramExternal(tgUserId, "+79991100101");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile")) {
        const id = url.includes("pdf-a") ? "pdf-a" : "pdf-b";
        return new Response(JSON.stringify({ ok: true, result: { file_path: `documents/${id}.pdf` } }), {
          status: 200,
        });
      }
      if (url.includes("pdf-a")) return new Response(PDF_A, { status: 200 });
      if (url.includes("pdf-b")) return new Response(PDF_B, { status: 200 });
      return originalFetch(input);
    };

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const pool = getPool()!;
    const wh = (updateId: number, body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
        .send({ update_id: updateId, ...body });
    const priv = { chat: { id: tgUserId, type: "private" }, from: { id: tgUserId, is_bot: false } };
    let seq = 881001010;
    assert.equal((await wh(++seq, { message: { message_id: 1, date: 1, ...priv, text: "Создать передачу" } })).status, 200);
    assert.equal((await wh(++seq, { message: { message_id: 2, date: 2, ...priv, text: "Пакет PDF" } })).status, 200);

    for (const [fid, name] of [
      ["tg-pdf-a", "first.pdf"],
      ["tg-pdf-b", "second.pdf"],
    ] as const) {
      assert.equal(
        (
          await wh(++seq, {
            message: {
              message_id: seq,
              date: seq,
              ...priv,
              document: { file_id: fid, file_name: name, mime_type: "application/pdf" },
            },
          })
        ).status,
        200,
      );
    }

    const replyRow = await pool.query<{ reply_text: string }>(
      `SELECT reply_text FROM tanbot_telegram_update_dedup WHERE update_id=$1`,
      [seq],
    );
    assert.match(replyRow.rows[0]!.reply_text, /Файлы:\s*2\/5/u);

    const files = await pool.query<{ mime_type: string; storage_key: string; byte_size: string }>(
      `SELECT mime_type, storage_key, byte_size::text FROM tt_external_request_draft_files ORDER BY sort_order`,
    );
    assert.equal(files.rowCount, 2);
    assert.equal(files.rows[0]!.mime_type, "application/pdf");
    assert.equal(files.rows[1]!.mime_type, "application/pdf");
    const bytes0 = await readAttachmentBytes(files.rows[0]!.storage_key, pool);
    const bytes1 = await readAttachmentBytes(files.rows[1]!.storage_key, pool);
    assert.deepEqual(bytes0, PDF_A);
    assert.deepEqual(bytes1, PDF_B);

    globalThis.fetch = originalFetch;
  });

  it("Telegram: fake PDF is rejected with saved count and Next still available after one valid PDF", async () => {
    const tgUserId = 88100201;
    await seedTelegramExternal(tgUserId, "+79991100201");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile")) {
        const path = url.includes("file_id=good") ? "documents/good.pdf" : "documents/bad.pdf";
        return new Response(JSON.stringify({ ok: true, result: { file_path: path } }), { status: 200 });
      }
      if (url.includes("good.pdf")) return new Response(PDF_A, { status: 200 });
      if (url.includes("bad.pdf")) return new Response(Buffer.from("<html>fake</html>", "utf8"), { status: 200 });
      return originalFetch(input);
    };

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const pool = getPool()!;
    const wh = (updateId: number, body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
        .send({ update_id: updateId, ...body });
    const priv = { chat: { id: tgUserId, type: "private" }, from: { id: tgUserId, is_bot: false } };
    let seq = 881002010;
    await wh(++seq, { message: { message_id: 1, date: 1, ...priv, text: "Создать передачу" } });
    await wh(++seq, { message: { message_id: 2, date: 2, ...priv, text: "Смешанный пакет" } });
    await wh(++seq, {
      message: {
        message_id: 3,
        date: 3,
        ...priv,
        document: { file_id: "good", file_name: "ok.pdf", mime_type: "application/pdf" },
      },
    });
    await wh(++seq, {
      message: {
        message_id: 4,
        date: 4,
        ...priv,
        document: { file_id: "bad", file_name: "bad.pdf", mime_type: "application/pdf" },
      },
    });
    const reply = await pool.query<{ reply_text: string }>(`SELECT reply_text FROM tanbot_telegram_update_dedup WHERE update_id=$1`, [
      seq,
    ]);
    assert.match(reply.rows[0]!.reply_text, /Файлы:\s*1\/5/u);
    assert.match(reply.rows[0]!.reply_text, /не является PDF|Поддерживаются/iu);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_external_request_draft_files f
       JOIN tt_external_request_drafts d ON d.id = f.draft_id
       WHERE d.messenger_chat_id=$1`,
      [`native:ext:telegram:${tgUserId}`],
    );
    assert.equal(count.rows[0]!.c, 1);
    globalThis.fetch = originalFetch;
  });

  it("MAX: mixed image+PDF in one message preserves order and inspect sends file attachment", async () => {
    const maxUserId = 77100301;
    const maxChatId = 88100399;
    const phone = "+79991100301";
    await seedTelegramExternal(88100300, "+79990003301");
    const pool = getPool()!;
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Max PDF', $1)`, [
      phone,
    ]);
    const partyId = (await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [phone]))
      .rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'Max PDF',$2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid,'max',$2,$3)`,
      [personId, String(maxUserId), String(maxChatId)],
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("getImage")) return new Response(JPEG, { status: 200 });
      if (url.includes("getFile")) return new Response(PDF_A, { status: 200 });
      return originalFetch(input);
    };

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const poolAfter = getPool()!;
    const maxWh = (body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-max/webhook")
        .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
        .send(body);

    assert.equal(
      (
        await maxWh({
          update_type: "message_created",
          timestamp: 2001,
          message: {
            sender: { user_id: maxUserId, is_bot: false },
            recipient: { chat_id: maxChatId, chat_type: "dialog" },
            body: { text: "Создать передачу", mid: "m-start" },
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await maxWh({
          update_type: "message_created",
          timestamp: 2002,
          message: {
            sender: { user_id: maxUserId, is_bot: false },
            recipient: { chat_id: maxChatId, chat_type: "dialog" },
            body: { text: "Комплект", mid: "m-item" },
          },
        })
      ).status,
      200,
    );

    const dedupMid = "m-mixed-album";
    assert.equal(
      (
        await maxWh({
          update_type: "message_created",
          timestamp: 2003,
          message: {
            sender: { user_id: maxUserId, is_bot: false },
            recipient: { chat_id: maxChatId, chat_type: "dialog" },
            body: {
              mid: dedupMid,
              attachments: [
                { type: "image", payload: { url: "https://iu.oneme.ru/getImage?token=img1", token: "img-tok" } },
                {
                  type: "file",
                  filename: "scan.pdf",
                  payload: { url: "https://iu.oneme.ru/getFile?token=pdf1", token: "pdf-tok" },
                },
              ],
            },
          },
        })
      ).status,
      200,
    );

    const draft = await poolAfter.query<{ id: string; payload: { revision: number } }>(
      `SELECT id::text, payload FROM tt_external_request_drafts WHERE messenger_chat_id LIKE 'native:ext:max:%'`,
    );
    const draftIdForFiles = draft.rows[0]!.id;
    const files = await poolAfter.query<{ mime_type: string; sort_order: number; max_file_token: string | null }>(
      `SELECT mime_type, sort_order, max_file_token FROM tt_external_request_draft_files
       WHERE draft_id=$1::uuid ORDER BY sort_order`,
      [draftIdForFiles],
    );
    assert.equal(files.rowCount, 2);
    assert.match(files.rows[0]!.mime_type, /^image\//);
    assert.equal(files.rows[1]!.mime_type, "application/pdf");

    let draftId = draftIdForFiles;
    let rev = Number(draft.rows[0]!.payload.revision);
    const maxCb = (payload: string, ts: number) => ({
      update_type: "message_callback",
      timestamp: ts,
      callback: {
        callback_id: `cb-${ts}`,
        payload,
        user: { user_id: maxUserId, is_bot: false },
      },
      message: { recipient: { chat_id: maxChatId, chat_type: "dialog" } },
    });
    assert.equal((await maxWh(maxCb(buildNativeCreateCallback("photo_next", draftId, rev)!, 2004))).status, 200);
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );
    assert.equal((await maxWh(maxCb(buildNativeCreateCallback("comment_skip", draftId, rev)!, 2005))).status, 200);
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );
    assert.equal(
      (
        await maxWh({
          update_type: "message_created",
          timestamp: 2006,
          message: {
            sender: { user_id: maxUserId, is_bot: false },
            recipient: { chat_id: maxChatId, chat_type: "dialog" },
            body: { text: "+79990001101", mid: "m-rec-phone" },
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await maxWh({
          update_type: "message_created",
          timestamp: 2007,
          message: {
            sender: { user_id: maxUserId, is_bot: false },
            recipient: { chat_id: maxChatId, chat_type: "dialog" },
            body: { text: "Получатель PDF MAX", mid: "m-rec-name" },
          },
        })
      ).status,
      200,
    );
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );
    assert.equal((await maxWh(maxCb(buildNativeCreateCallback("due", draftId, rev, "n")!, 2008))).status, 200);
    rev = Number(
      (await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!
        .payload.revision,
    );

    assert.equal(
      (await maxWh(maxCb(buildNativeCreateCallback("photo_view", draftId, rev, "1")!, 2009))).status,
      200,
    );

    const viewRow = await poolAfter.query<{ dedup_key: string; reply_text: string }>(
      `SELECT dedup_key, reply_text FROM tanbot_max_update_dedup
       WHERE reply_text LIKE 'PDF %' ORDER BY received_at DESC LIMIT 1`,
    );
    assert.equal(viewRow.rowCount, 1, "photo_view must commit a PDF inspect reply");

    const maxCfg = loadTanbotMaxStage2Config();
    assert.ok(maxCfg.ok);
    const maxSink: Array<Record<string, unknown>> = [];
    const maxTransport: MaxDeliveryTransport = async (input) => {
      maxSink.push(buildMaxSendMessagePayload(input));
      return { ok: true, result: {} };
    };
    await deliverMaxWebhookReply(poolAfter, maxCfg.config, maxTransport, viewRow.rows[0]!.dedup_key, {
      userId: BigInt(maxUserId),
      chatId: BigInt(maxChatId),
      text: viewRow.rows[0]!.reply_text,
    });
    const filePayload = maxSink.find((p) => {
      const atts = p.attachments as unknown[] | undefined;
      return Array.isArray(atts) && atts.some((a) => (a as { type?: string }).type === "file");
    });
    assert.ok(filePayload, `expected MAX file attachment, got ${JSON.stringify(maxSink)}`);
    const fileAtt = (filePayload!.attachments as Array<{ type: string; payload: { token: string } }>).find(
      (a) => a.type === "file",
    );
    assert.equal(fileAtt?.payload.token, "pdf-tok");

    globalThis.fetch = originalFetch;
  });

  it("Telegram summary inspect delivers PDF via sendDocument", async () => {
    const tgUserId = 88100401;
    await seedTelegramExternal(tgUserId, "+79991100401");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/one.pdf" } }), {
          status: 200,
        });
      }
      if (url.includes("/file/bot")) return new Response(PDF_A, { status: 200 });
      return originalFetch(input);
    };

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const pool = getPool()!;
    const wh = (updateId: number, body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!)
        .send({ update_id: updateId, ...body });
    const priv = { chat: { id: tgUserId, type: "private" }, from: { id: tgUserId, is_bot: false } };
    let seq = 881004010;
    await wh(++seq, { message: { message_id: 1, date: 1, ...priv, text: "Создать передачу" } });
    await wh(++seq, { message: { message_id: 2, date: 2, ...priv, text: "Док" } });
    await wh(++seq, {
      message: {
        message_id: 3,
        date: 3,
        ...priv,
        document: { file_id: "doc-inspect", file_name: "one.pdf", mime_type: "application/pdf" },
      },
    });
    const draft = await pool.query<{ id: string; payload: { revision: number } }>(
      `SELECT id::text, payload FROM tt_external_request_drafts WHERE messenger_chat_id=$1`,
      [`native:ext:telegram:${tgUserId}`],
    );
    const draftId = draft.rows[0]!.id;
    let rev = Number(draft.rows[0]!.payload.revision);
    const cb = (data: string) => ({
      callback_query: {
        id: `cb-${data}`,
        from: { id: tgUserId, is_bot: false },
        message: { chat: { id: tgUserId, type: "private" } },
        data,
      },
    });
    await wh(++seq, cb(buildNativeCreateCallback("photo_next", draftId, rev)!));
    rev = Number((await pool.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await wh(++seq, cb(buildNativeCreateCallback("comment_skip", draftId, rev)!));
    rev = Number((await pool.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await wh(++seq, { message: { message_id: 4, date: 4, ...priv, text: "+79990001101" } });
    await wh(++seq, { message: { message_id: 5, date: 5, ...priv, text: "Получатель PDF TG" } });
    rev = Number((await pool.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await wh(++seq, cb(buildNativeCreateCallback("due", draftId, rev, "n")!));
    rev = Number((await pool.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await wh(++seq, cb(buildNativeCreateCallback("photo_view", draftId, rev, "0")!));

    const viewRow = await pool.query<{ update_id: string; reply_text: string }>(
      `SELECT update_id::text, reply_text FROM tanbot_telegram_update_dedup
       WHERE reply_text LIKE 'PDF %' ORDER BY received_at DESC LIMIT 1`,
    );
    assert.equal(viewRow.rowCount, 1, "photo_view must commit a PDF inspect reply");

    const tgCfg = loadTanbotTelegramStage2Config();
    assert.ok(tgCfg.ok);
    const sink: Array<{ method: string; body: Record<string, unknown> }> = [];
    const transport: TelegramDeliveryTransport = async (input) => {
      sink.push({ method: input.method, body: { ...input.body } });
      return { ok: true, result: {} };
    };
    await deliverTelegramWebhookReply(pool, tgCfg.config, transport, Number(viewRow.rows[0]!.update_id), {
      chatId: BigInt(tgUserId),
      text: viewRow.rows[0]!.reply_text,
    });
    const docCall = sink.find((c) => c.method === "sendDocument");
    assert.ok(docCall, `expected sendDocument among ${sink.map((s) => s.method).join(",")}`);
    assert.equal(docCall.body.document, "doc-inspect");
    globalThis.fetch = originalFetch;
  });
});
