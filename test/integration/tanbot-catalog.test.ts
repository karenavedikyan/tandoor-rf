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
import type { CatalogBotReply } from "../../src/tanbot/catalog";
import { readCatalogBrowseInput, filteredCatalogView } from "../../src/tanbot/catalog-browse";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { deliverTelegramWebhookReply } from "../../src/tanbot-telegram/webhook-reply-delivery";
import { deliverMaxWebhookReply } from "../../src/tanbot-max/webhook-reply-delivery";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { deliverCatalogGallery } from "../../src/tanbot/catalog-gallery-delivery";

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
    properties: [...p.properties.filter(v => v.name !== "Цвет"),
      { guid: id(888), name: "Цвет", value: i % 2 ? "Чёрный" : "Белый" },
      { guid: id(889), name: "ВХ. По назначению", value: i % 3 ? "для квартиры" : "для дома/для квартиры" },
      { guid: id(890), name: "ВХ. Стеклопакет", value: i % 4 ? "нет" : "да" }],
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
    // Distinct fixture sides must have distinct image content. Repeated content
    // under different SKU paths is covered explicitly by the deduplication test.
    const panel = await makeThumbnails(await sharp({ create: {
      width: 200, height: 800, channels: 3, background: "#ffffff",
    } }).jpeg().toBuffer()); assert.ok(panel);
    for (const path of [...Array.from({ length: 11 }, (_, i) => `${i + 1}.jpg`), "second.jpg"]) {
      const image = path === "second.jpg" ? panel : thumbnails;
      await pool().query(`INSERT INTO internal_catalog_thumbnails
        (snapshot_id,source_path,recipe,status,small_bytes,small_sha256,list_bytes,list_sha256)
        VALUES($1,$2,$3,'ready',$4,$5,$6,$7)`,
      [snapshot, path, THUMBNAIL_RECIPE, image.small, image.smallHash, image.list, image.listHash]);
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
  function telegramRaw(input: { text?: string; callback?: string; group?: boolean; userId?: number }, updateId = ++seq) {
    const userId = input.userId ?? 710001;
    const message = { message_id: updateId, from: { id: userId, is_bot: false },
      chat: { id: userId, type: input.group ? "group" : "private" }, text: input.text ?? "" };
    return input.callback ? { update_id: updateId, callback_query: { id: `cat-${updateId}`, from: message.from,
      data: input.callback, message } } : { update_id: updateId, message };
  }
  function maxRaw(input: { text?: string; callback?: string; group?: boolean; userId?: number; chatId?: number }, timestamp = ++seq) {
    const message = { sender: { user_id: input.userId ?? 710002, is_bot: false },
      recipient: { chat_id: input.chatId ?? 910002, chat_type: input.group ? "chat" : "dialog" },
      body: { mid: `cat-${timestamp}`, text: input.text ?? "" } };
    return { update_type: input.callback ? "message_callback" : "message_created", timestamp, message,
      ...(input.callback ? { callback: { callback_id: `cat-cb-${timestamp}`, user: message.sender, payload: input.callback } } : {}) };
  }
  const buttons = (r: Partial<CatalogBotReply>) => r.inlineButtons
    ? r.inlineButtons.flat().map(b => ({ text: b.text, data: "payload" in b ? b.payload : "" }))
    : (r.replyMarkup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard
      .flat().map(b => ({ text: b.text, data: b.callback_data }));
  for (const channel of ["telegram", "max"] as const) {
    it(`${channel}: filters + search + photo through webhooks, retry and foreign/stale button isolation`, async () => {
      const send = async (input: { text?: string; callback?: string; userId?: number; chatId?: number }) => {
        const result = channel === "telegram"
          ? await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw(input))
          : await handleTanbotMaxUpdate(pool(), max.config, maxRaw(input));
        assert.ok(result.reply);
        return result.reply as Partial<CatalogBotReply> & { text: string };
      };
      const click = async (r: Partial<CatalogBotReply>, label: string) => {
        const button = buttons(r).find(b => b.text === label); assert.ok(button, label);
        return send({ callback: button.data });
      };
      let r = await send({ callback: catalogCallback("g", snapshot, CATALOG_BOT_SECTIONS[0].guid) });
      const initial = r;
      const foreign = await send({ callback: buttons(r).find(b => b.text === "Фильтры")!.data, userId: 710003 });
      assert.match(foreign.text, /устарела/); assert.equal(foreign.replyExtra?.catalogBrowse, undefined);
      if (channel === "max") {
        const otherChat = await send({ callback: buttons(r)[0].data, chatId: 910003 });
        assert.equal(otherChat.replyExtra?.catalogBrowse, undefined);
      }
      r = await click(r, "Фильтры"); r = await click(r, "Цвет"); r = await click(r, "Белый");
      const labels = buttons(r).map(b => b.text).join("\n");
      assert.match(labels, /Модель 01/); assert.ok(!labels.includes("Модель 02"));
      r = await click(r, "Фильтры");
      assert.ok(!buttons(r).some(b => /Размер|Сторона|Толщина/.test(b.text)));
      r = await click(r, "Назначение"); r = await click(r, "Для дома");
      assert.match(r.text, /Моделей с фото: 2\./);
      r = await click(r, "Фильтры"); r = await click(r, "Остекление"); r = await click(r, "Со стеклом");
      assert.match(r.text, /Моделей с фото: 1\./);
      r = await click(r, "Найти по названию");
      assert.equal((r.replyExtra?.catalogBrowse as { awaitingSearch: boolean }).awaitingSearch, true);
      // Same webhook retry must replay exactly the committed reply, not search twice.
      const raw = channel === "telegram" ? telegramRaw({ text: "модель 01" }) : maxRaw({ text: "модель 01" });
      const first = channel === "telegram"
        ? await handleTanbotTelegramUpdate(pool(), tg.config, raw) : await handleTanbotMaxUpdate(pool(), max.config, raw);
      const duplicate = channel === "telegram"
        ? await handleTanbotTelegramUpdate(pool(), tg.config, raw) : await handleTanbotMaxUpdate(pool(), max.config, raw);
      assert.equal(duplicate.reply?.text, first.reply?.text);
      assert.deepEqual(duplicate.reply?.replyExtra?.catalogBrowse, first.reply?.replyExtra?.catalogBrowse);
      assert.deepEqual(buttons(duplicate.reply!), buttons(first.reply!));
      assert.ok(first.reply); r = first.reply as typeof r;
      assert.match(r.text, /Моделей с фото: 1\./);
      r = await click(r, buttons(r).find(b => b.text.includes("Модель 01"))!.text);
      assert.equal((r.replyExtra?.catalogPhoto as { productGuid: string }).productGuid, id(1));
      assert.equal(r.text, "Модель 01");
      assert.ok(!buttons(r).some(b => /Фильтры|вариант|Размер|открыван/.test(b.text)));
      assert.equal((r.replyExtra?.catalogBrowse as { filters: Record<string, string> }).filters["Цвет"], "белый");
      const stale = await send({ callback: buttons(initial)[0].data });
      assert.match(stale.text, /Кнопка устарела/);
      assert.equal((stale.replyExtra?.catalogBrowse as { query: string }).query, "модель 01");
      r = await click(stale, "Сбросить отбор");
      assert.match(r.text, /Моделей с фото: 11\./);
      // Leaving the catalogue must cancel plain-text capture, without clearing tracker drafts.
      r = await click(r, "Найти по названию");
      await send({ text: "/start" });
      const client = await pool().connect();
      try {
        assert.equal(await readCatalogBrowseInput(client, channel, channel === "telegram" ? 710001n : 910002n,
          channel === "telegram" ? 710001n : 710002n, "Модель"), null);
      } finally { client.release(); }
    });
    it(`${channel}: search session expires after 30 minutes and never resumes from an older prompt`, async () => {
      const raw = channel === "telegram"
        ? telegramRaw({ callback: catalogCallback("g", snapshot, CATALOG_BOT_SECTIONS[0].guid) })
        : maxRaw({ callback: catalogCallback("g", snapshot, CATALOG_BOT_SECTIONS[0].guid) });
      const first = channel === "telegram"
        ? await handleTanbotTelegramUpdate(pool(), tg.config, raw) : await handleTanbotMaxUpdate(pool(), max.config, raw);
      assert.ok(first.reply);
      const search = buttons(first.reply).find(b => b.text === "Найти по названию")!.data;
      if (channel === "telegram") await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw({ callback: search }));
      else await handleTanbotMaxUpdate(pool(), max.config, maxRaw({ callback: search }));
      const table = channel === "telegram" ? "tanbot_telegram_update_dedup" : "tanbot_max_update_dedup";
      await pool().query(`UPDATE ${table} SET received_at=NOW()-INTERVAL '31 minutes'`);
      const client = await pool().connect();
      try {
        assert.equal(await readCatalogBrowseInput(client, channel, channel === "telegram" ? 710001n : 910002n,
          channel === "telegram" ? 710001n : 710002n, "Модель"), null);
      } finally { client.release(); }
      // These synthetic conversation steps have no delivery transport. Keep
      // them out of the separate retry-worker transport test later in this suite.
      await pool().query(`UPDATE ${table} SET reply_delivered_at=NOW() WHERE reply_delivered_at IS NULL`);
    });
  }
  it("eligibility excludes no-reference, unavailable, corrupt and unprepared images before pagination", async () => {
    const view = await loadCatalogBotView(pool()); assert.ok(view);
    assert.equal(view.products.length, 11);
    assert.equal(view.products[0].files.length, 2);
    for (const n of [12, 13, 14, 15]) assert.ok(!view.products.some(p => p.guid === id(n)));
    assert.equal(await beforeRecords(), initialRecords);
  });
  it("DB-backed Amulet gallery removes size/handing copies by verified image content in both channels", async () => {
    const db = await pool().connect();
    try {
      await db.query("BEGIN");
      for (let i = 0; i < 4; i++) {
        const p = { ...products[i],
          name: `Амулет ${i < 2 ? 860 : 960}х2050 ${i % 2 ? "правая" : "левая"}`,
          properties: [{ guid: id(99010), name: "Название для сайта", value: "Амулет" }],
          files: [0, 1].map(side => ({ guid: id(99100 + i * 2 + side), name: `${side}_амулет`,
            path: `synthetic/amulet/${i}/${side}.jpg` })),
        };
        await db.query("UPDATE internal_catalog_products SET record=$3::jsonb WHERE snapshot_id=$1 AND guid=$2",
          [snapshot, p.guid, JSON.stringify(p)]);
        for (const [side, file] of p.files.entries()) {
          await db.query(`INSERT INTO internal_catalog_thumbnails
            (snapshot_id,source_path,recipe,status,small_bytes,small_sha256,list_bytes,list_sha256)
            SELECT snapshot_id,$2,recipe,status,small_bytes,small_sha256,list_bytes,list_sha256
            FROM internal_catalog_thumbnails WHERE snapshot_id=$1 AND source_path=$3 AND recipe=$4`,
          [snapshot, file.path, side ? "second.jpg" : "1.jpg", THUMBNAIL_RECIPE]);
        }
      }
      const before = await db.query("SELECT guid,record FROM internal_catalog_products ORDER BY guid");
      const view = await loadCatalogBotView(db); assert.ok(view);
      const family = view.products.filter(p => p.properties.some(x => x.value === "Амулет"));
      assert.equal(family.length, 4);
      assert.equal(family.flatMap(p => p.files).length, 8, "all source references are preserved");
      assert.equal(new Set(family.flatMap(p => p.files.map(f => view.photoHashes?.get(`${p.guid}:${f.guid}`)))).size, 2);
      const { buildCatalogBotReply, readCatalogGallery, readCatalogPhoto } = await import("../../src/tanbot/catalog");
      for (const channel of ["max", "telegram"] as const) {
        const r = buildCatalogBotReply(channel, view, catalogCallback("p", snapshot, products[3].guid));
        const photos = readCatalogGallery(r.replyExtra)!;
        assert.equal(photos.length, 2);
        assert.deepEqual(readCatalogPhoto(r.replyExtra), photos[0]);
        assert.notDeepEqual(await catalogPhotoBytes(db, photos[0]), await catalogPhotoBytes(db, photos[1]));
        assert.doesNotMatch(JSON.stringify(r), /photoHashes|sha256|synthetic\/amulet/);
      }
      assert.deepEqual((await db.query("SELECT guid,record FROM internal_catalog_products ORDER BY guid")).rows, before.rows);
    } finally { await db.query("ROLLBACK"); db.release(); }
  });
  it("DB-backed catalogue keeps door leaves with compatible trim and uses the specific coating in both channels", async () => {
    const db = await pool().connect();
    try {
      await db.query("BEGIN");
      for (let i = 0; i < 2; i++) {
        const p = { ...products[i], guid_group: id(99000), name_group: "Межкомнатные двери",
          properties: [...products[i].properties,
            { guid: id(99001), name: "Тип погонажа", value: "Телескопический погонаж" },
            { guid: id(99002), name: "Покрытие", value: "Современные покрытия" },
            { guid: id(99003), name: "Покрытие двери", value: i ? "ПВХ" : "ПЭТ" }],
        };
        await db.query("UPDATE internal_catalog_products SET record=$3::jsonb WHERE snapshot_id=$1 AND guid=$2",
          [snapshot, p.guid, JSON.stringify(p)]);
      }
      const v = await loadCatalogBotView(db); assert.ok(v);
      const selected = filteredCatalogView(v, { category: CATALOG_BOT_SECTIONS[1].guid,
        query: "", filters: { Покрытие: "пэт" } });
      assert.deepEqual(selected.products.map(p => p.guid), [products[0].guid]);
      for (const channel of ["max", "telegram"] as const) {
        const reply = (await import("../../src/tanbot/catalog")).buildCatalogBotReply(channel, selected,
          catalogCallback("l", snapshot, CATALOG_BOT_SECTIONS[1].guid));
        assert.match(reply.text, /Моделей с фото: 1\./);
        assert.ok(await catalogPhotoBytes(db, { snapshotId: snapshot, productGuid: products[0].guid,
          fileGuid: products[0].files[0].guid }));
      }
    } finally { await db.query("ROLLBACK"); db.release(); }
  });
  it("DB-backed ungrouped models and typed floor stops retain filters and exact photos in both channels", async () => {
    const db = await pool().connect();
    try {
      await db.query("BEGIN");
      const sources: [string, string][][] = [
        [["ВХ. Терморазрыв", "нет"]],
        [["Название для сайта", "Simple 8"], ["Вид двери", "Глухая (ДГ)"], ["Покрытие двери", "ПЭТ"]],
        [["Тип фурнитуры", "Ручка"]],
        [["Тип фурнитуры", "Ограничитель"]],
        [["Тип фурнитуры", "Ограничитель"]],
        [["Тип фурнитуры", "Ручка"], ["Вид двери", "Глухая"]],
      ];
      for (let i = 0; i < sources.length; i++) {
        const p = { ...products[i], guid_group: undefined, name_group: undefined,
          chapter: i === 3 ? [{ guid: id(98000), name: "Ограничители напольные" }] :
            i === 4 ? [{ guid: id(98001), name: "Напольные покрытия" }] : [],
          properties: sources[i].map(([name, value], j) => ({ guid: id(98100 + j), name, value })),
        };
        if (i === 3) Object.assign(p, { guid_group: id(98002), name_group: "МЕЖКОМНАТКА фурнитура" });
        await db.query("UPDATE internal_catalog_products SET record=$3::jsonb WHERE snapshot_id=$1 AND guid=$2",
          [snapshot, p.guid, JSON.stringify(p)]);
      }
      const before = (await db.query("SELECT guid,record FROM internal_catalog_products ORDER BY guid")).rows;
      const v = await loadCatalogBotView(db); assert.ok(v);
      const expectedCategories = [0, 1, 2, 2];
      for (let i = 0; i < 4; i++) {
        assert.equal(v.products.find(p => p.guid === products[i].guid)?.guid_group,
          CATALOG_BOT_SECTIONS[expectedCategories[i]].guid);
        assert.ok(await catalogPhotoBytes(db, { snapshotId: snapshot, productGuid: products[i].guid,
          fileGuid: products[i].files[0].guid }));
      }
      for (const i of [4, 5]) {
        assert.ok(!v.products.some(p => p.guid === products[i].guid));
        assert.equal(await catalogPhotoBytes(db, { snapshotId: snapshot, productGuid: products[i].guid,
          fileGuid: products[i].files[0].guid }), null);
      }
      const selected = filteredCatalogView(v, { category: CATALOG_BOT_SECTIONS[1].guid,
        query: "simple", filters: { Покрытие: "пэт", Остекление: "без стекла" } });
      assert.deepEqual(selected.products.map(p => p.guid), [products[1].guid]);
      for (const channel of ["max", "telegram"] as const) {
        const { buildCatalogBotReply, readCatalogPhoto } = await import("../../src/tanbot/catalog");
        const r = buildCatalogBotReply(channel, selected, catalogCallback("p", snapshot, products[1].guid));
        assert.equal(r.text, "Simple 8");
        assert.equal(readCatalogPhoto(r.replyExtra)?.fileGuid, products[1].files[0].guid);
      }
      assert.deepEqual((await db.query("SELECT guid,record FROM internal_catalog_products ORDER BY guid")).rows, before);
    } finally { await db.query("ROLLBACK"); db.release(); }
  });
  it("catalogue and exact-photo reads do not load any commercial rows", async () => {
    const sql: string[] = [];
    const db = { query: async (text: string, params?: unknown[]) => {
      sql.push(text); return pool().query(text, params);
    } } as unknown as import("pg").PoolClient;
    const view = await loadCatalogBotView(db); assert.ok(view);
    assert.equal(view.context.commerce.size, 0); assert.deepEqual(view.context.priceTypes, []);
    assert.ok(await catalogPhotoBytes(db, { snapshotId: snapshot, productGuid: id(1), fileGuid: id(1000) }));
    const groupReads = sql.filter(s => s.includes("onec_manual_object_versions"));
    assert.equal(groupReads.length, 2);
    for (const s of groupReads) {
      assert.match(s, /WHERE v.entity_kind='group' AND v.file_key='groups'/);
      assert.doesNotMatch(s, /prices|stocks/);
    }
  });
  it("authenticated MAX route acknowledges in parallel; an acknowledgement failure never blocks the persisted reply", async () => {
    const savedFetch = globalThis.fetch;
    const savedEnabled = process.env.TANBOT_MAX_DELIVERY_ENABLED;
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "true";
    try {
      for (const failure of [false, true]) {
        const events: string[] = [];
        let finishAck: (() => void) | undefined, ackFinished = false, replyBeforeAck = false;
        globalThis.fetch = async (url, init) => {
          const endpoint = new URL(String(url));
          assert.equal(endpoint.origin, "https://platform-api2.max.ru");
          if (endpoint.pathname === "/answers") {
            events.push("ack-start");
            assert.deepEqual(JSON.parse(String(init?.body)), {});
            if (failure) return Response.json({}, { status: 503 });
            return new Promise<Response>((resolve, reject) => {
              finishAck = () => { ackFinished = true; resolve(Response.json({ success: true })); };
              init?.signal?.addEventListener("abort", () => {
                ackFinished = true; reject(new DOMException("Aborted", "AbortError"));
              }, { once: true });
            });
          }
          assert.equal(endpoint.pathname, "/messages");
          events.push("reply-send"); replyBeforeAck = !ackFinished; finishAck?.();
          return Response.json({ message: { mid: "synthetic-ack-reply" } });
        };
        // Authentication gate must prevent even an acknowledgement side effect.
        assert.equal((await request(app).post("/api/tanbot-max/webhook")
          .send(maxRaw({ callback: "cat:root" }))).status, 403);
        assert.equal(events.length, 0);
        const response = await request(app).post("/api/tanbot-max/webhook")
          .set("X-Max-Bot-Api-Secret", max.config.webhookSecret!)
          .send(maxRaw({ callback: "cat:root" }));
        assert.equal(response.status, 200);
        assert.deepEqual(events, ["ack-start", "reply-send"]);
        if (!failure) assert.ok(replyBeforeAck, "reply generation/delivery must not wait for the acknowledgement");
      }
    } finally {
      globalThis.fetch = savedFetch;
      if (savedEnabled === undefined) delete process.env.TANBOT_MAX_DELIVERY_ENABLED;
      else process.env.TANBOT_MAX_DELIVERY_ENABLED = savedEnabled;
    }
  });
  it("Telegram acknowledges a photo click before the catalog read and sends the gallery without waiting for the acknowledgement", { timeout: 10000 }, async () => {
    const savedFetch = globalThis.fetch;
    const savedEnabled = process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED;
    const client = await pool().connect();
    let finishAck: (() => void) | undefined;
    let pendingRequest: Promise<request.Response> | undefined;
    const events: string[] = [];
    const post = () => request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", tg.config.webhookSecret!);
    const raw = telegramRaw({ callback: catalogCallback("p", snapshot, id(1)) });
    let markAckStarted!: () => void;
    const ackStarted = new Promise<void>(resolve => { markAckStarted = resolve; });
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "true";
    try {
      globalThis.fetch = async (url, init) => {
        const method = new URL(String(url)).pathname.split("/").at(-1)!;
        events.push(method);
        if (method === "answerCallbackQuery") {
          assert.deepEqual(JSON.parse(String(init?.body)), { callback_query_id: `cat-${raw.update_id}` });
          return new Promise<Response>((resolve) => {
            finishAck = () => resolve(Response.json({ ok: true, result: true }));
            init?.signal?.addEventListener("abort", () => {
              events.push("ack-timeout");
              finishAck?.();
            }, { once: true });
            markAckStarted();
          });
        }
        assert.equal(method, "sendPhoto");
        assert.ok(init?.body instanceof FormData && init.body.get("photo") instanceof Blob);
        finishAck?.();
        return Response.json({ ok: true, result: { message_id: 1 } });
      };
      assert.equal((await request(app).post("/api/tanbot-telegram/webhook").send(raw)).status, 403);
      assert.equal((await post().send(telegramRaw({ callback: "cat:root", group: true }))).status, 200);
      assert.deepEqual(events, []);
      await client.query("BEGIN");
      await client.query("LOCK TABLE internal_catalog_snapshots IN ACCESS EXCLUSIVE MODE");
      pendingRequest = post().send(raw).timeout({ deadline: 4000 }).then(result => result);
      await Promise.race([ackStarted, pendingRequest.then(() => assert.fail("webhook finished without acknowledging"))]);
      assert.deepEqual(events, ["answerCallbackQuery"]);
      await client.query("ROLLBACK");
      assert.equal((await pendingRequest).status, 200);
      assert.deepEqual(events, ["answerCallbackQuery", "sendPhoto", "sendPhoto"]);

      events.length = 0;
      globalThis.fetch = async (url) => {
        const method = new URL(String(url)).pathname.split("/").at(-1)!;
        events.push(method);
        return method === "answerCallbackQuery" ? Response.json({}, { status: 503 })
          : Response.json({ ok: true, result: { message_id: 2 } });
      };
      assert.equal((await post().send(telegramRaw({ callback: "cat:root" }))).status, 200);
      assert.deepEqual(events, ["answerCallbackQuery", "sendMessage", "sendMessage"]);
    } finally {
      finishAck?.();
      await client.query("ROLLBACK");
      client.release();
      await pendingRequest?.catch(() => {});
      globalThis.fetch = savedFetch;
      if (savedEnabled === undefined) delete process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED;
      else process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = savedEnabled;
    }
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
  it("Telegram model selection sends its whole gallery once, with buttons on the final photo", async () => {
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
        assert.equal(Boolean(p.body.reply_markup), calls.filter(m => m === "sendPhoto").length === 2);
        assert.equal(p.body.text, undefined); assert.equal(p.body.photo, undefined);
      }
      return { ok: true as const, result: { message_id: 1 } };
    };
    await deliverTelegramWebhookReply(pool(), tg.config, transport, selected.updateId, selected.reply);
    await deliverTelegramWebhookReply(pool(), tg.config, transport, selected.updateId, selected.reply);
    assert.equal(calls.filter(m => m === "sendPhoto").length, 2);
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
      assert.equal(p.maxImageToken, attempts === 2 ? "persisted-synthetic-token" : undefined);
      return attempts === 1 ? { ok: false as const, code: "ATTACHMENT_NOT_READY", message: "not ready",
        retryable: true, uploadedImageToken: "persisted-synthetic-token" } :
        { ok: true as const, result: { message: { body: { mid: "sent" } } } };
    };
    assert.equal((await deliverMaxWebhookReply(pool(), max.config, transport, selected.dedupKey, selected.reply))?.ok, false);
    const pending = (await pool().query("SELECT reply_extra,reply_delivered_at FROM tanbot_max_update_dedup WHERE dedup_key=$1",
      [selected.dedupKey])).rows[0];
    assert.equal(pending.reply_delivered_at, null);
    assert.equal(pending.reply_extra.catalogGalleryProgress.imageToken, "persisted-synthetic-token");
    // Drain only this row (others are Telegram), through the existing retry worker.
    await processUndeliveredMaxWebhookReplies(pool(), max.config, transport, { deliveryEnabled: true });
    assert.equal(attempts, 3);
    await deliverMaxWebhookReply(pool(), max.config, transport, selected.dedupKey, selected.reply);
    assert.equal(attempts, 3);
  });
  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: a mid-gallery failure resumes at the unsent photo under concurrent retries`, async () => {
      const selected = channel === "max"
        ? await handleTanbotMaxUpdate(pool(), max.config, maxRaw({ callback: catalogCallback("p", snapshot, id(1)) }))
        : await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw({ callback: catalogCallback("p", snapshot, id(1)) }));
      assert.ok(selected.reply);
      let calls = 0;
      const deliver = () => channel === "max"
        ? deliverMaxWebhookReply(pool(), max.config, async p => {
          calls++; assert.ok(p.photoBytes);
          assert.equal(Boolean(p.inlineButtons), calls !== 1);
          assert.equal(p.maxImageToken, calls === 3 ? "gallery-second-token" : undefined);
          return calls === 2 ? { ok: false, code: "ATTACHMENT_NOT_READY", message: "synthetic",
            retryable: true, uploadedImageToken: "gallery-second-token" } : { ok: true, result: {} };
        }, (selected as { dedupKey: string }).dedupKey, selected.reply as never)
        : deliverTelegramWebhookReply(pool(), tg.config, async p => {
          if (p.method === "answerCallbackQuery") return { ok: true, result: {} };
          calls++; assert.equal(p.method, "sendPhoto"); assert.ok(p.photoBytes);
          assert.equal(Boolean(p.body.reply_markup), calls !== 1);
          return calls === 2 ? { ok: false, code: "NETWORK_ERROR", message: "synthetic", retryable: true } :
            { ok: true, result: {} };
        }, (selected as { updateId: number }).updateId, selected.reply as never);
      assert.equal((await deliver())?.ok, false);
      const pending = channel === "max"
        ? (await pool().query("SELECT reply_extra,reply_delivered_at FROM tanbot_max_update_dedup WHERE dedup_key=$1",
          [(selected as { dedupKey: string }).dedupKey])).rows[0]
        : (await pool().query("SELECT reply_extra,reply_delivered_at FROM tanbot_telegram_update_dedup WHERE update_id=$1",
          [(selected as { updateId: number }).updateId])).rows[0];
      assert.equal(pending.reply_extra.catalogGalleryProgress.sent, 1);
      assert.equal(pending.reply_delivered_at, null);
      await Promise.all([deliver(), deliver()]);
      assert.equal(calls, 3, "the acknowledged first photo is not sent again");
      await deliver(); assert.equal(calls, 3);
    });
  }
  it("a long gallery yields with persisted progress and continues instead of silently truncating", async () => {
    const { buildCatalogBotReply, readCatalogGallery } = await import("../../src/tanbot/catalog");
    const v = await loadCatalogBotView(pool()); assert.ok(v);
    const r = buildCatalogBotReply("max", v, catalogCallback("p", snapshot, id(1)));
    const photos = readCatalogGallery(r.replyExtra)!;
    assert.equal(photos.length, 2);
    const client = await pool().connect();
    let extra = r.replyExtra, calls = 0, clock = 0;
    const send = async (bytes: Buffer | null) => { assert.ok(bytes); calls++; return { ok: true as const, result: {} }; };
    try {
      const first = await deliverCatalogGallery({ client, photos, extra,
        persist: async next => { extra = next; }, send, now: () => (clock++ ? 20001 : 0) });
      assert.equal(first.ok, false);
      assert.equal(!first.ok && first.code, "CATALOG_GALLERY_PENDING");
      assert.equal((extra.catalogGalleryProgress as { sent: number }).sent, 1);
      assert.equal((await deliverCatalogGallery({ client, photos, extra,
        persist: async next => { extra = next; }, send, now: () => 0 })).ok, true);
      assert.equal(calls, 2);
      assert.equal((extra.catalogGalleryProgress as { sent: number }).sent, 2);
    } finally { client.release(); }
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
    for (const channel of ["telegram", "max"] as const) {
      const send = async (input: { text?: string; callback?: string }) => {
        const result = channel === "telegram"
          ? await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw(input))
          : await handleTanbotMaxUpdate(pool(), max.config, maxRaw(input));
        assert.ok(result.reply); return result.reply;
      };
      const click = async (r: Partial<CatalogBotReply>, label: string) => {
        const button = buttons(r).find(b => b.text === label); assert.ok(button, label);
        return send({ callback: button.data });
      };
      let r = await send({ callback: catalogCallback("g", snapshot, CATALOG_BOT_SECTIONS[0].guid) });
      r = await click(r, "Фильтры"); r = await click(r, "Цвет"); r = await click(r, "Белый");
      r = await click(r, "Найти по названию"); r = await send({ text: "Модель 01" });
      r = await click(r, buttons(r).find(b => b.text.includes("Модель 01"))!.text);
      assert.ok(r.replyExtra?.catalogPhoto);
      assert.equal(r.text, "Модель 01");
      r = await click(r, "К моделям");
      r = await click(r, "Найти по названию"); r = await send({ text: "Отмена" });
      assert.equal((r.replyExtra?.catalogBrowse as { awaitingSearch: boolean }).awaitingSearch, false);
    }
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
  it("new daily snapshots keep matching photos without reviving old queued replies or changed files", async () => {
    const old = await handleTanbotTelegramUpdate(pool(), tg.config,
      telegramRaw({ callback: catalogCallback("p", snapshot, id(3)) }));
    assert.ok(old.reply); assert.ok(old.updateId);
    const changed = [
      { ...products[0], name: "Новый снимок",
        files: [products[0].files[0], { ...products[0].files[1], path: "updated-second.jpg" }] },
      { ...products[1], files: [{ ...products[1].files[0], guid: id(6001) }] },
      { ...products[2], guid: id(6002) },
      products[3],
      products[4],
    ];
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(changed)));
    const intermediate = (await importSnapshot(pool(), parsed, "new-synthetic.json", parsed.sha256)).snapshotId;
    const daily = parseProductsJson(Buffer.from(JSON.stringify(changed.map((p, i) =>
      i === 0 ? { ...p, name: "Ежедневное обновление" } : p))));
    const latest = (await importSnapshot(pool(), daily, "second-daily-synthetic.json", daily.sha256)).snapshotId;
    const selected = { snapshotId: latest, productGuid: id(1), fileGuid: id(1000) };
    assert.deepEqual(await catalogPhotoBytes(pool(), selected), bytes);
    assert.equal(await catalogPhotoBytes(pool(), { ...selected, fileGuid: id(2000) }), null);
    assert.equal(await catalogPhotoBytes(pool(), { ...selected, productGuid: id(2), fileGuid: id(6001) }), null);
    assert.equal(await catalogPhotoBytes(pool(), { ...selected, productGuid: id(6002), fileGuid: id(1002) }), null);
    const current = await loadCatalogBotView(pool());
    assert.equal(current?.snapshotId, latest);
    assert.equal(current?.products.length, 3);
    assert.equal(current?.products[0].name, "Ежедневное обновление");
    assert.deepEqual(current?.products[0].files.map(f => f.guid), [id(1000)]);
    for (const channel of ["telegram", "max"] as const) {
      const cb = catalogCallback("p", latest, id(1));
      const result = channel === "telegram"
        ? await handleTanbotTelegramUpdate(pool(), tg.config, telegramRaw({ callback: cb }))
        : await handleTanbotMaxUpdate(pool(), max.config, maxRaw({ callback: cb }));
      assert.deepEqual(result.reply?.replyExtra?.catalogPhoto, selected);
    }
    await pool().query(`INSERT INTO internal_catalog_thumbnails
      (snapshot_id,source_path,recipe,status,small_bytes,small_sha256,list_bytes,list_sha256)
      SELECT $1::uuid,'1.jpg',recipe,status,small_bytes,small_sha256,list_bytes,list_sha256
      FROM internal_catalog_thumbnails WHERE snapshot_id=$2 AND source_path='second.jpg'`,
    [latest, snapshot]);
    await pool().query(`INSERT INTO internal_catalog_thumbnails(snapshot_id,source_path,recipe,status)
      VALUES($1,'4.jpg',$2,'unavailable'),($3,'5.jpg',$2,'unavailable')`, [latest, THUMBNAIL_RECIPE, intermediate]);
    const newBytes = await catalogPhotoBytes(pool(), selected);
    assert.ok(newBytes);
    assert.notDeepEqual(newBytes, bytes);
    assert.equal(await catalogPhotoBytes(pool(), { ...selected, productGuid: id(4), fileGuid: id(1003) }), null);
    assert.deepEqual(await catalogPhotoBytes(pool(), { ...selected, productGuid: id(5), fileGuid: id(1004) }), bytes);
    assert.deepEqual((await loadCatalogBotView(pool()))?.products.map(p => p.guid), [id(1), id(5)]);
    await pool().query(`INSERT INTO internal_catalog_thumbnails
      (snapshot_id,source_path,recipe,status,small_bytes,small_sha256,list_bytes,list_sha256)
      SELECT $1::uuid,'updated-second.jpg',recipe,status,small_bytes,small_sha256,list_bytes,list_sha256
      FROM internal_catalog_thumbnails WHERE snapshot_id=$2 AND source_path='1.jpg'`,
    [latest, snapshot]);
    assert.deepEqual(await catalogPhotoBytes(pool(), { ...selected, fileGuid: id(2000) }), bytes);
    assert.deepEqual((await loadCatalogBotView(pool()))?.products[0].files.map(f => f.guid), [id(1000), id(2000)]);
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
    await pool().query("DELETE FROM internal_catalog_thumbnails WHERE snapshot_id<>$1", [snapshot]);
    await pool().query("DELETE FROM internal_catalog_products WHERE snapshot_id<>$1", [snapshot]);
    await pool().query("DELETE FROM internal_catalog_snapshots WHERE id<>$1", [snapshot]);
  });
});
