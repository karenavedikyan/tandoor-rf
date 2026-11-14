import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { createHash } from "node:crypto";
import { Client as FtpClient } from "basic-ftp";
import sharp from "sharp";
import request from "supertest";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { catalogueFixture, fixtureGuid as id } from "../helpers/internal-catalog-fixtures";
import { parseProductsJson } from "../../src/internal-catalog/model";
import { importSnapshot } from "../../src/internal-catalog/repository";
import { makeThumbnails, THUMBNAIL_RECIPE } from "../../src/internal-catalog/thumbnails";
import { loadCatalogBotView, catalogPhotoBytes, catalogCallback, CATALOG_BOT_SECTIONS } from "../../src/tanbot/catalog";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";

describe("catalogue bots: isolated PostgreSQL / fake messengers", { concurrency: false }, () => {
  let snapshot: string, bytes: Buffer;
  let tg: ReturnType<typeof loadTanbotTelegramStage2Config> & { ok: true };
  let max: ReturnType<typeof loadTanbotMaxStage2Config> & { ok: true };
  let app: ReturnType<typeof import("../../src/server").createApp>;
  let seq = 8300000;
  const pool = () => getPool()!;
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const products = catalogueFixture(15).map((p, i) => ({
    ...p, chapter: [], name: `Модель ${String(i + 1).padStart(2, "0")}`, guid_group: id(500), name_group: "Входные двери",
    files: [{ guid: id(1000 + i), name: "private-source-name", path: `${i + 1}.jpg` }],
  }));
  products[0].files.push({ guid: id(2000), name: "private-second", path: "second.jpg" });
  products[11].files = []; // no photo reference
  const beforeRecords = async () => JSON.stringify((await pool().query(
    "SELECT guid,record FROM internal_catalog_products ORDER BY guid")).rows);
  let initialRecords: string, originalFetch: typeof fetch;
  let ftp: ReturnType<typeof mock.method>;
  before(async () => {
    const url = getIntegrationDatabaseUrl();
    setIntegrationEnv(url);
    Object.assign(process.env, {
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
      TANBOT_TELEGRAM_DELIVERY_ENABLED: "false", TANBOT_TELEGRAM_BOT_TOKEN: "123456789:SYNTH_CATALOG_TEST_TOKEN",
      TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_catalog_bot", TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-catalog-telegram-pepper",
      TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-catalog-telegram-secret",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "SYNTH_CATALOG_MAX_TOKEN", TANBOT_MAX_BOT_USERNAME: "synthetic_catalog_bot",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-catalog-max-pepper", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-catalog-max-secret",
    });
    await prepareDatabase(url); await resetPoolForTests();
    const t = loadTanbotTelegramStage2Config(), m = loadTanbotMaxStage2Config();
    assert.ok(t.ok); assert.ok(m.ok); tg = t; max = m;
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products)));
    snapshot = (await importSnapshot(pool(), parsed, "synthetic-catalog.json", parsed.sha256)).snapshotId;
    const source = await sharp({ create: { width: 200, height: 800, channels: 3, background: "#426428" } }).jpeg().toBuffer();
    const thumbnails = await makeThumbnails(source); assert.ok(thumbnails); bytes = thumbnails.list;
    for (const path of [...Array.from({ length: 11 }, (_, i) => `${i + 1}.jpg`), "second.jpg"]) {
      await pool().query(`INSERT INTO internal_catalog_thumbnails
        (snapshot_id,source_path,recipe,status,small_bytes,small_sha256,list_bytes,list_sha256)
        VALUES($1,$2,$3,'ready',$4,$5,$6,$7)`,
      [snapshot, path, THUMBNAIL_RECIPE, thumbnails.small, thumbnails.smallHash, bytes, hash(bytes)]);
    }
    // A file reference is not evidence of a usable image.
    await pool().query(`INSERT INTO internal_catalog_thumbnails(snapshot_id,source_path,recipe,status)
      VALUES($1,'13.jpg',$2,'unavailable')`, [snapshot, THUMBNAIL_RECIPE]);
    await pool().query(`INSERT INTO internal_catalog_thumbnails
      (snapshot_id,source_path,recipe,status,small_bytes,small_sha256,list_bytes,list_sha256)
      VALUES($1,'14.jpg',$2,'ready',$3,$4,$3,$5)`,
    [snapshot, THUMBNAIL_RECIPE, bytes, hash(bytes), "0".repeat(64)]); // corrupt hash
    // 15.jpg is pending/unprepared.
    initialRecords = await beforeRecords();
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("No live messenger/source HTTP permitted in catalogue acceptance"); };
    ftp = mock.method(FtpClient.prototype, "access", async () => { throw new Error("No FTP permitted"); });
    app = (await import("../../src/server")).createApp();
  });
  after(async () => {
    assert.equal(await beforeRecords(), initialRecords);
    assert.equal(ftp.mock.callCount(), 0); ftp.mock.restore();
    globalThis.fetch = originalFetch;
    await closePool();
  });
  function telegramRaw(input: { text?: string; callback?: string; group?: boolean }, updateId = ++seq) {
    const message = { message_id: updateId, from: { id: 710001, is_bot: false },
      chat: { id: 710001, type: input.group ? "group" : "private" }, text: input.text ?? "" };
    return input.callback ? { update_id: updateId, callback_query: { id: `cat-${updateId}`, from: message.from,
      data: input.callback, message } } : { update_id: updateId, message };
  }
  function maxRaw(input: { text?: string; callback?: string; group?: boolean }, timestamp = ++seq) {
    const message = { sender: { user_id: 710002, is_bot: false },
      recipient: { chat_id: 910002, chat_type: input.group ? "chat" : "dialog" },
      body: { mid: `cat-${timestamp}`, text: input.text ?? "" } };
    return { update_type: input.callback ? "message_callback" : "message_created", timestamp, message,
      ...(input.callback ? { callback: { callback_id: `cat-cb-${timestamp}`, user: message.sender, payload: input.callback } } : {}) };
  }
  it("eligibility excludes no-reference, unavailable, corrupt and unprepared images before pagination", async () => {
    const view = await loadCatalogBotView(pool()); assert.ok(view);
    assert.equal(view.products.length, 11);
    assert.equal(view.products[0].files.length, 2);
    for (const n of [12, 13, 14, 15]) assert.ok(!view.products.some(p => p.guid === id(n)));
    assert.equal(await beforeRecords(), initialRecords);
  });
  it("photo read rechecks file/SKU/snapshot ownership, not only a caller-supplied path", async () => {
    const input = { snapshotId: snapshot, productGuid: id(1), fileGuid: id(1000) };
    assert.deepEqual(await catalogPhotoBytes(pool(), input), bytes);
    assert.equal(await catalogPhotoBytes(pool(), { ...input, productGuid: id(2) }), null);
    assert.equal(await catalogPhotoBytes(pool(), { ...input, fileGuid: id(9999) }), null);
    assert.equal(await catalogPhotoBytes(pool(), { ...input, snapshotId: id(99999) }), null);
  });
  it("missing media schema returns an empty view without aborting a webhook transaction", async () => {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE internal_catalog_thumbnails RENAME TO synthetic_hidden_thumbnails");
      assert.equal((await loadCatalogBotView(client))?.products.length, 0);
      assert.equal((await client.query("SELECT 1 AS still_active")).rows[0].still_active, 1);
    } finally {
      await client.query("ROLLBACK"); client.release();
    }
  });
  it("public projection does not grant access to internal-catalog or accept forged webhooks", async () => {
    assert.equal((await request(app).get("/api/internal-catalog/meta")).status, 401);
    assert.equal((await request(app).post("/api/tanbot-telegram/webhook").send(telegramRaw({ text: "Каталог" }))).status, 403);
    assert.equal((await request(app).post("/api/tanbot-max/webhook").send(maxRaw({ text: "Каталог" }))).status, 403);
    assert.equal((await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", tg.config.webhookSecret!).send(telegramRaw({ text: "Каталог" }))).status, 200);
  });
  it("Telegram category -> models -> actual photo uses one deduplicated primary sendPhoto with keyboard", async () => {
    const entry = await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw({ text: "Каталог" })); assert.ok(entry.reply);
    assert.match(entry.reply.text, /Категории/);
    const listing = await handleTanbotTelegramUpdate(pool(), tg.config,
      telegramRaw({ callback: catalogCallback("l", snapshot, CATALOG_BOT_SECTIONS[0].guid) })); assert.ok(listing.reply);
    assert.match(listing.reply.text, /Моделей с фото: 11/);
    const raw = telegramRaw({ callback: catalogCallback("p", snapshot, id(1)) });
    const selected = await handleTanbotTelegramUpdate(pool(), tg.config, raw); assert.ok(selected.reply); assert.ok(selected.updateId);
    const calls: string[] = [];
    const transport = async (p: Parameters<Parameters<typeof deliverTelegramWebhookReply>[2]>[0]) => {
      calls.push(p.method);
      if (p.method === "sendPhoto") {
        assert.ok(p.photoBytes); assert.equal((await sharp(p.photoBytes).metadata()).format, "jpeg");
        assert.match(String(p.body.caption), /Модель 01/);
        assert.ok(p.body.reply_markup); assert.equal(p.body.text, undefined); assert.equal(p.body.photo, undefined);
      }
      return { ok: true as const, result: { message_id: 1 } };
    };
    await deliverTelegramWebhookReply(pool(), tg.config, transport, selected.updateId, selected.reply);
    await deliverTelegramWebhookReply(pool(), tg.config, transport, selected.updateId, selected.reply);
    assert.equal(calls.filter(m => m === "sendPhoto").length, 1);
    assert.equal(calls.filter(m => m === "sendMessage").length, 0);
    assert.equal((await handleTanbotTelegramUpdate(pool(), tg.config, raw)).reply, null);
  });
  it("MAX sends to messenger user, not dialog; upload retry retains token and does not mark sent early", async () => {
    const selected = await handleTanbotMaxUpdate(pool(), max.config,
      maxRaw({ callback: catalogCallback("p", snapshot, id(1)) }));
    assert.ok(selected.reply); assert.ok(selected.dedupKey);
    let attempts = 0;
    const transport = async (p: Parameters<Parameters<typeof deliverMaxWebhookReply>[2]>[0]) => {
      attempts++; assert.equal(p.userId, 710002n); assert.ok(p.photoBytes);
      assert.equal(p.maxImageToken, attempts === 1 ? undefined : "persisted-synthetic-token");
      return attempts === 1 ? { ok: false as const, code: "ATTACHMENT_NOT_READY", message: "not ready",
        retryable: true, uploadedImageToken: "persisted-synthetic-token" } :
        { ok: true as const, result: { message: { body: { mid: "sent" } } } };
    };
    assert.equal((await deliverMaxWebhookReply(pool(), max.config, transport, selected.dedupKey, selected.reply))?.ok, false);
    const pending = (await pool().query("SELECT reply_extra,reply_delivered_at FROM tanbot_max_update_dedup WHERE dedup_key=$1",
      [selected.dedupKey])).rows[0];
    assert.equal(pending.reply_delivered_at, null);
    assert.equal(pending.reply_extra.catalogImageToken, "persisted-synthetic-token");
    // Drain only this row (others are Telegram), through the existing retry worker.
    await processUndeliveredMaxWebhookReplies(pool(), max.config, transport, { deliveryEnabled: true });
    assert.equal(attempts, 2);
    await deliverMaxWebhookReply(pool(), max.config, transport, selected.dedupKey, selected.reply);
    assert.equal(attempts, 2);
  });
  it("Telegram failed send remains retryable and concurrent delivery workers serialize the photo", async () => {
    const selected = await handleTanbotTelegramUpdate(pool(), tg.config,
      telegramRaw({ callback: catalogCallback("p", snapshot, id(2)) }));
    assert.ok(selected.reply); assert.ok(selected.updateId);
    let attempts = 0;
    const transport = async (p: Parameters<Parameters<typeof deliverTelegramWebhookReply>[2]>[0]) => {
      if (p.method === "answerCallbackQuery") return { ok: true as const, result: true };
      attempts++;
      return attempts === 1 ? { ok: false as const, code: "NETWORK_ERROR", message: "synthetic", retryable: true } :
        { ok: true as const, result: {} };
    };
    assert.equal((await deliverTelegramWebhookReply(pool(), tg.config, transport, selected.updateId, selected.reply))?.ok, false);
    await Promise.all([1, 2].map(() => deliverTelegramWebhookReply(pool(), tg.config, transport, selected.updateId!, selected.reply)));
    assert.equal(attempts, 2);
  });
  it("neither channel exposes catalogue in groups", async () => {
    assert.equal((await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw({ text: "Каталог", group: true }))).reply, null);
    const result = await handleTanbotMaxUpdate(pool(), max.config, maxRaw({ text: "Каталог", group: true }));
    assert.ok(result.reply); assert.match(result.reply.text, /личном диалоге/);
    assert.equal(result.reply.replyExtra, undefined);
  });
  it("catalogue navigation preserves identities, rights, transfers and drafts", async () => {
    await pool().query(`INSERT INTO tt_external_request_drafts(channel,messenger_chat_id,payload)
      VALUES('telegram','710001','{"item":"preserve-telegram-draft"}'),
            ('max','910002','{"item":"preserve-max-draft"}')`);
    const tables = ["users", "access_grants", "rop_team_members", "coordinator_team_assignments",
      "user_onec_employee_links", "tt_transfers", "tt_external_persons", "tt_external_person_verifications",
      "tt_external_request_drafts", "tanbot_telegram_accounts", "tanbot_max_accounts"];
    // Compare exact rows rather than only counts; catalogue never provisions identities.
    const state = async () => Promise.all(tables.map(async table => JSON.stringify(
      (await pool().query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows)));
    const before = await state();
    await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw({ text: "Каталог" }));
    await handleTanbotMaxUpdate(pool(), max.config, maxRaw({ callback: "cat:root" }));
    assert.deepEqual(await state(), before);
  });
  it("excluded product categories disappear from DB views and queued photos in both channels", async () => {
    for (const name of ["Напольные покрытия", "Межкомнатные двери (погонаж)"]) {
      const callback = catalogCallback("p", snapshot, id(1));
      const t = await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw({ callback }));
      const m = await handleTanbotMaxUpdate(pool(), max.config, maxRaw({ callback }));
      assert.ok(t.reply); assert.ok(t.updateId); assert.ok(m.reply); assert.ok(m.dedupKey);
      try {
        await pool().query(`UPDATE internal_catalog_products SET record=jsonb_set(record,'{name_group}',to_jsonb($3::text))
          WHERE snapshot_id=$1 AND guid=$2`, [snapshot, id(1), name]);
        assert.ok(!(await loadCatalogBotView(pool()))!.products.some(p => p.guid === id(1)));
        assert.equal(await catalogPhotoBytes(pool(), { snapshotId: snapshot, productGuid: id(1), fileGuid: id(1000) }), null);
        let telegramFallback = false, maxFallback = false;
        await deliverTelegramWebhookReply(pool(), tg.config, async input => {
          if (input.method !== "answerCallbackQuery") {
            assert.equal(input.method, "sendMessage"); assert.equal(input.photoBytes, undefined);
            assert.match(String(input.body.text), /недоступна/); telegramFallback = true;
          }
          return { ok: true, result: {} };
        }, t.updateId, t.reply);
        await deliverMaxWebhookReply(pool(), max.config, async input => {
          assert.equal(input.photoBytes, undefined); assert.equal(input.maxImageToken, undefined);
          assert.match(input.text, /недоступна/); maxFallback = true;
          return { ok: true, result: {} };
        }, m.dedupKey, m.reply);
        assert.ok(telegramFallback); assert.ok(maxFallback);
      } finally {
        await pool().query(`UPDATE internal_catalog_products SET record=$3::jsonb WHERE snapshot_id=$1 AND guid=$2`,
          [snapshot, id(1), JSON.stringify(products[0])]);
      }
    }
  });
  it("a new snapshot invalidates old buttons and queued photo delivery, without fallback to another source", async () => {
    const old = await handleTanbotTelegramUpdate(pool(), tg.config,
      telegramRaw({ callback: catalogCallback("p", snapshot, id(3)) }));
    assert.ok(old.reply); assert.ok(old.updateId);
    const parsed = parseProductsJson(Buffer.from(JSON.stringify([{ ...products[0], name: "Новый снимок" }])));
    await importSnapshot(pool(), parsed, "new-synthetic.json", parsed.sha256);
    const calls: string[] = [];
    await deliverTelegramWebhookReply(pool(), tg.config, async p => {
      calls.push(p.method);
      if (p.method === "sendMessage") assert.match(String(p.body.text), /недоступна/);
      assert.equal(p.photoBytes, undefined);
      return { ok: true, result: {} };
    }, old.updateId, old.reply);
    assert.ok(!calls.includes("sendPhoto"));
    assert.equal(await catalogPhotoBytes(pool(), { snapshotId: snapshot, productGuid: id(1), fileGuid: id(1000) }), null);
    // After cleanup only compare the original snapshot's records.
    await pool().query("DELETE FROM internal_catalog_products WHERE snapshot_id<>$1", [snapshot]);
    await pool().query("DELETE FROM internal_catalog_snapshots WHERE id<>$1", [snapshot]);
  });
});
