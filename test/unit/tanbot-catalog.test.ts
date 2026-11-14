import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { buildCatalogBotReply, catalogCallback, isCatalogRequest, parseCatalogCallback, readCatalogPhoto, CATALOG_BOT_SECTIONS, restrictCatalogBotView,
  type CatalogView } from "../../src/tanbot/catalog";
import { catalogJpeg, uploadMaxCatalogPhoto } from "../../src/tanbot/catalog-media";
import { createDefaultTelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import { createDefaultMaxDeliveryTransport, parseMaxSendResult } from "../../src/tanbot-max/delivery-transport";
import { buildMainMenuInline, menuReplyKeyboard } from "../../src/tanbot/native-create/keyboards";
import { parseMaxReplyExtra, parseTelegramReplyExtra } from "../../src/tanbot/webhook-reply-extra";
import { type Product } from "../../src/internal-catalog/model";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot = id(1000);
const product = (n: number): Product => ({
  guid: id(n), name: `Модель ${String(n).padStart(2, "0")}`, chapter: [], properties: [],
  guid_group: id(100), name_group: "Входные двери",
  files: [{ guid: id(2000 + n), name: "Не публиковать это имя файла", path: `private/${n}.jpg` }],
});
function view(count = 12): CatalogView {
  return { snapshotId: snapshot, products: Array.from({ length: count }, (_, i) => product(i + 1)),
    context: { commerce: new Map(), priceTypes: [], groups: [
      { guid: id(100), name: "Входные двери", parent: null, conflict: false },
      { guid: id(101), name: "Категория без фото", parent: null, conflict: false },
    ] } };
}
function choices(r: ReturnType<typeof buildCatalogBotReply>) {
  if (r.inlineButtons) return r.inlineButtons.flat().map(b => ({ text: b.text, data: "payload" in b ? b.payload : "" }));
  const markup = r.replyMarkup as { inline_keyboard: { text: string; callback_data: string }[][] };
  return markup.inline_keyboard.flat().map(b => ({ text: b.text, data: b.callback_data }));
}

describe("bot catalogue: public photo-only projection", () => {
  it("recognizes only explicit entry points and its own callbacks, not draft text", () => {
    for (const text of ["Каталог", " каталог ", "/catalog", "/catalog@Tandoor_bot"]) assert.ok(isCatalogRequest(text));
    for (const text of ["/catalogue", "/start token", "Отправить каталог клиенту", "123456"]) assert.ok(!isCatalogRequest(text));
    assert.ok(isCatalogRequest(null, "cat:root"));
    assert.ok(!isCatalogRequest(null, "nc:menu"));
  });
  it("callback roundtrip is versioned and bounded; invalid / oversized inputs rejected", () => {
    for (const action of ["g", "l", "p"] as const) {
      const data = catalogCallback(action, snapshot, id(1), 9999);
      assert.ok(Buffer.byteLength(data) <= 64);
      assert.deepEqual(parseCatalogCallback(data), { action, tag: snapshot.replace(/-/g, "").slice(0, 12), id: id(1), page: 9999 });
    }
    for (const bad of ["cat:p:x:1:0", "cat:p:000000000000:-:-1", "cat:g:000000000000:-:10000", "cat:root", "cat:g:000000000000:-:00"]) {
      assert.equal(parseCatalogCallback(bad), null);
    }
    assert.throws(() => catalogCallback("g", snapshot, id(1), -1));
  });
  for (const channel of ["telegram", "max"] as const) {
    it(`${channel}: only three approved sections; excludes floors/pogonazh from lists, variants and forged callbacks`, () => {
      const v = view(14);
      const names = ["Входные двери", "Межкомнатные двери", "Фурнитура (ручки)", "Фурнитура (прочее)",
        "Напольные покрытия", "Межкомнатные двери (погонаж)", "Входные двери", "Входные двери",
        "Неизвестное", "Неизвестное", "Коллекция", "Входные двери", "Входные двери", "Погонаж"];
      v.products.forEach((p, i) => { p.guid_group = id(300 + i); p.name_group = names[i]; });
      v.context.groups = [{ guid: id(400), name: "Межкомнатные двери", parent: null, conflict: false },
        { guid: id(310), name: "Коллекция", parent: id(400), conflict: false }];
      v.products[6].properties.push({ guid: id(777), name: "Тип погонажа", value: "Наличник" });
      v.products[7].files = [];
      v.products[9].name = "Входные двери"; // Never infer eligibility from product names.
      v.products[11].chapter = [{ guid: id(800), name: "Ламинат" }];
      v.products[12].chapter = [{ guid: id(801), name: "Межкомнатные двери" }]; // conflicting source evidence
      const source = JSON.stringify(v);
      const projected = restrictCatalogBotView(v);
      assert.deepEqual(projected.products.map(p => p.guid), [1, 2, 3, 4, 11].map(id));
      assert.equal(JSON.stringify(v), source, "source records and their GUIDs remain unchanged");
      assert.deepEqual(choices(buildCatalogBotReply(channel, v)).filter(b => b.text !== "Главное меню").map(b => b.text),
        ["Входные двери", "Межкомнатные двери", "Фурнитура"]);
      const all = buildCatalogBotReply(channel, v, catalogCallback("l", snapshot));
      assert.match(all.text, /Моделей с фото: 5/);
      assert.ok(!JSON.stringify(all).includes("Ламинат"));
      for (const n of [5, 6, 7, 8, 9, 10, 12, 13, 14]) {
        assert.equal(readCatalogPhoto(buildCatalogBotReply(channel, v, catalogCallback("p", snapshot, id(n))).replyExtra), null);
      }
      // Even identical names/prices must not offer an excluded SKU as a variant.
      v.products[5].name = v.products[0].name;
      const selected = buildCatalogBotReply(channel, v, catalogCallback("p", snapshot, id(1)));
      assert.ok(!choices(selected).some(b => parseCatalogCallback(b.data)?.id === id(6)));
      assert.equal(readCatalogPhoto(buildCatalogBotReply(channel, v, catalogCallback("p", snapshot, id(3))).replyExtra)?.productGuid, id(3));
    });
    it(`${channel}: hides empty categories and paginates models with back/next/menu`, () => {
      const v = view();
      const root = buildCatalogBotReply(channel, v);
      assert.ok(choices(root).some(b => b.text === "Входные двери"));
      assert.ok(!JSON.stringify(root).includes("Категория без фото"));
      const first = buildCatalogBotReply(channel, v, catalogCallback("l", snapshot, CATALOG_BOT_SECTIONS[0].guid));
      assert.equal(choices(first).filter(b => b.text.startsWith("Модель")).length, 8);
      const next = choices(first).find(b => b.text === "Далее")!;
      const second = buildCatalogBotReply(channel, v, next.data);
      assert.equal(choices(second).filter(b => b.text.startsWith("Модель")).length, 4);
      assert.ok(choices(second).some(b => b.text === "Назад"));
      assert.ok(choices(second).some(b => b.text === "Главное меню"));
    });
    it(`${channel}: sends exact selected SKU/file and gallery navigation, no private fields`, () => {
      const v = view(1);
      v.products[0].files.push({ guid: id(999), name: "second", path: "private/second.jpg" });
      v.products[0].properties.push({ guid: id(666), name: "Секретная характеристика", value: "PRIVATE_SECRET" });
      v.context.commerce.set(id(1), { prices: [{ guid: id(800), name: "Закупка", value: 1234567, conflict: false }],
        quantity: 987654, pricesImportedAt: "PRIVATE_DATE", stocksImportedAt: null, warehouses: [] });
      const r = buildCatalogBotReply(channel, v, catalogCallback("p", snapshot, id(1)));
      assert.deepEqual(readCatalogPhoto(r.replyExtra), { snapshotId: snapshot, productGuid: id(1), fileGuid: id(2001) });
      assert.match(r.text, /Фото 1 из 2/);
      const next = choices(r).find(b => b.text === "Следующее фото")!;
      const second = buildCatalogBotReply(channel, v, next.data);
      assert.equal(readCatalogPhoto(second.replyExtra)?.fileGuid, id(999));
      assert.doesNotMatch(JSON.stringify(r), /private\/|PRIVATE_|1234567|987654|Закупка|Не публиковать/);
    });
    it(`${channel}: handles absent model and stale snapshot without sending a photo`, () => {
      const missing = buildCatalogBotReply(channel, view(), catalogCallback("p", snapshot, id(9999)));
      assert.equal(readCatalogPhoto(missing.replyExtra), null);
      const other = { ...view(), snapshotId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
      const stale = buildCatalogBotReply(channel, other, catalogCallback("p", snapshot, id(1)));
      assert.match(stale.text, /устарела/);
      assert.equal(readCatalogPhoto(stale.replyExtra), null);
      assert.match(buildCatalogBotReply(channel, null).text, /пока недоступны/);
    });
    it(`${channel}: reuses name+RRP grouping; different prices stay separate, each photo SKU stays selectable`, () => {
      const v = view(3), priceId = id(800);
      v.context.priceTypes = [{ guid: priceId, name: "РРЦ Тандор" }];
      for (let i = 0; i < 3; i++) {
        v.products[i].name = `Зефир 2000х${600 + i * 100}`;
        v.products[i].properties = [{ guid: id(900), name: "Размер, мм", value: `2000х${600 + i * 100}` }];
        v.context.commerce.set(id(i + 1), { prices: [{ guid: priceId, name: "РРЦ Тандор", value: i === 2 ? 200 : 100, conflict: false }],
          quantity: null, pricesImportedAt: null, stocksImportedAt: null, warehouses: [] });
      }
      const listing = buildCatalogBotReply(channel, v, catalogCallback("l", snapshot, CATALOG_BOT_SECTIONS[0].guid));
      assert.equal(choices(listing).filter(b => b.text.startsWith("Зефир")).length, 2);
      const model = buildCatalogBotReply(channel, v, catalogCallback("p", snapshot, id(1)));
      assert.ok(!choices(model).some(b => b.text.includes(id(2).slice(0, 8))), "human labels never expose technical GUIDs");
      const variant = choices(model).find(b => b.text.startsWith("2000×700"))!;
      assert.ok(variant);
      assert.equal(readCatalogPhoto(buildCatalogBotReply(channel, v, variant.data).replyExtra)?.productGuid, id(2));
    });
  }
  it("both menu entry points expose catalogue without changing transfer callbacks", () => {
    assert.ok(JSON.stringify(menuReplyKeyboard()).includes("Каталог"));
    for (const channel of ["telegram", "max"] as const) {
      assert.ok(JSON.stringify(buildMainMenuInline(channel)).includes("cat:root"));
    }
  });
  it("stored extras retain photo references and MAX upload token through retry parsers", () => {
    const r = buildCatalogBotReply("max", view(1), catalogCallback("p", snapshot, id(1)));
    const raw = { ...r.replyExtra, catalogImageToken: "synthetic-media-token" };
    for (const parsed of [parseMaxReplyExtra(raw), parseTelegramReplyExtra(raw)]) {
      assert.deepEqual(readCatalogPhoto(parsed), readCatalogPhoto(raw));
    }
    assert.equal(parseMaxReplyExtra(raw).catalogImageToken, "synthetic-media-token");
    assert.equal(readCatalogPhoto({ catalogPhoto: { snapshotId: "../x" } }), null);
  });
});

describe("catalogue photo transports (mock HTTP only)", () => {
  const webp = () => sharp({ create: { width: 200, height: 640, channels: 3, background: "white" } }).webp().toBuffer();
  it("bounds WebP conversion, strips source metadata and preserves an extreme strip without cropping", async () => {
    const jpeg = await catalogJpeg(await webp()); assert.ok(jpeg);
    const meta = await sharp(jpeg).metadata(); assert.equal(meta.format, "jpeg"); assert.equal(meta.height, 640);
    assert.equal(await catalogJpeg(Buffer.alloc(131073)), null);
    assert.equal(await catalogJpeg(Buffer.from("corrupt")), null);
    const extreme = await sharp({ create: { width: 1, height: 640, channels: 3, background: "white" } }).webp().toBuffer();
    const padded = await catalogJpeg(extreme); assert.ok(padded);
    const pm = await sharp(padded).metadata(); assert.ok(pm.height! / pm.width! <= 20);
    const oversize = await sharp({ create: { width: 641, height: 640, channels: 3, background: "white" } }).webp().toBuffer();
    assert.equal(await catalogJpeg(oversize), null);
  });
  it("Telegram sends multipart sendPhoto with caption and buttons, never a private URL", async () => {
    const bytes = await catalogJpeg(await webp()); assert.ok(bytes);
    let calls = 0;
    const transport = createDefaultTelegramDeliveryTransport(async (url, init) => {
      calls++; assert.match(String(url), /\/sendPhoto$/); assert.equal(init?.redirect, "error");
      const form = init?.body as FormData; assert.ok(form instanceof FormData);
      assert.equal(form.get("caption"), "Зефир"); assert.ok(form.get("photo") instanceof Blob);
      assert.equal(form.get("reply_markup"), '{"inline_keyboard":[]}');
      assert.equal((init?.headers as Record<string, string>)["Content-Type"], undefined);
      return Response.json({ ok: true, result: { message_id: 1 } });
    });
    assert.ok((await transport({ method: "sendPhoto", token: "synthetic", body: { chat_id: "42", caption: "Зефир",
      reply_markup: { inline_keyboard: [] } }, photoBytes: bytes, timeoutMs: 1000, maxResponseBytes: 4096 })).ok);
    assert.equal(calls, 1);
  });
  it("MAX uploads one image, does not send bot authorization to CDN, and returns retry token", async () => {
    let calls = 0;
    const transport = createDefaultMaxDeliveryTransport(async (url, init) => {
      calls++; assert.equal(init?.redirect, "error");
      if (String(url).includes("/uploads?")) {
        assert.equal((init?.headers as Record<string, string>).Authorization, "synthetic");
        return Response.json({ url: "https://iu.oneme.ru/uploadImage?signed=1" });
      }
      if (String(url).startsWith("https://iu.oneme.ru")) {
        assert.equal((init?.headers as Record<string, string> | undefined)?.Authorization, undefined);
        assert.ok((init?.body as FormData).get("data") instanceof Blob);
        return Response.json({ photos: { "123": { token: "uploaded-token" } } });
      }
      const body = JSON.parse(String(init?.body));
      assert.equal(body.attachments[0].payload.token, "uploaded-token");
      return Response.json({ code: "attachment.not.ready" }, { status: 400 });
    }, {});
    const sent = await transport({ token: "synthetic", userId: 42n, text: "Зефир", photoBytes: Buffer.from("mock-jpeg"),
      timeoutMs: 1000, maxResponseBytes: 4096 });
    assert.equal(sent.ok, false); assert.equal(sent.uploadedImageToken, "uploaded-token");
    if (!sent.ok) assert.equal(sent.retryable, true);
    assert.equal(calls, 3);
  });
  it("MAX scopes its custom CA dispatcher to the API, not the globally trusted upload host", async () => {
    const calls: string[] = [];
    const transport = createDefaultMaxDeliveryTransport(async (url, init) => {
      const target = new URL(String(url));
      calls.push(target.hostname);
      const dispatcher = (init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher;
      if (target.hostname === "iu.oneme.ru") {
        assert.ok(dispatcher === undefined, "upload must retain the normal TLS trust store");
        assert.equal(new Headers(init?.headers).get("Authorization"), null);
        assert.equal(init?.redirect, "error");
        assert.ok((init?.body as FormData).get("data") instanceof Blob);
        return Response.json({ photos: { "123": { token: "uploaded-token" } } });
      }
      assert.equal(target.origin, "https://platform-api2.max.ru");
      assert.ok(dispatcher, "API still requires its configured CA");
      assert.equal(new Headers(init?.headers).get("Authorization"), "synthetic");
      if (target.pathname === "/uploads") return Response.json({ url: "https://iu.oneme.ru/uploadImage?signed=1" });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.attachments[0].payload.token, "uploaded-token");
      return Response.json({ message: { body: { mid: "sent" } } });
    }, { TANBOT_MAX_TLS_CA_BUNDLE: "certs/max/Russian_Trusted_CA.pem" });
    const result = await transport({ token: "synthetic", userId: 42n, text: "Модель",
      photoBytes: Buffer.from("mock-jpeg"), timeoutMs: 1000, maxResponseBytes: 4096 });
    assert.equal(result.ok, true, !result.ok ? result.message : undefined);
    assert.deepEqual(calls, ["platform-api2.max.ru", "iu.oneme.ru", "platform-api2.max.ru"]);
  });
  it("MAX reuses a persisted upload token on retry, without a second upload", async () => {
    let calls = 0;
    const transport = createDefaultMaxDeliveryTransport(async (url) => {
      calls++; assert.match(String(url), /\/messages\?/);
      return Response.json({ message: { body: { mid: "sent" } } });
    }, {});
    const result = await transport({ token: "synthetic", userId: 42n, text: "Модель", photoBytes: Buffer.from("mock"),
      maxImageToken: "existing-token", timeoutMs: 1000, maxResponseBytes: 4096 });
    assert.ok(result.ok); assert.equal(calls, 1);
  });
  it("MAX rejects a forged upload host and ambiguous uploaded photo set", async () => {
    for (const url of ["http://iu.oneme.ru/x", "https://127.0.0.1/x", "https://evil.example/x", "https://iu.oneme.ru.evil.example/x"]) {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => { calls++; return Response.json({ url }); };
      const token = await uploadMaxCatalogPhoto({ api: fetchImpl, upload: fetchImpl },
        { token: "synthetic", bytes: Buffer.from("mock"), signal: AbortSignal.timeout(1000), maxResponseBytes: 4096 });
      assert.equal(token, null); assert.equal(calls, 1);
    }
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      return ++calls === 1 ? Response.json({ url: "https://iu.oneme.ru/x" }) :
        Response.json({ photos: { a: { token: "one" }, b: { token: "two" } } });
    };
    const token = await uploadMaxCatalogPhoto({ api: fetchImpl, upload: fetchImpl },
      { token: "synthetic", bytes: Buffer.from("mock"), signal: AbortSignal.timeout(1000), maxResponseBytes: 4096 });
    assert.equal(token, null);
    assert.equal(parseMaxSendResult('{"code":"attachment.not.ready"}', 400).ok, false);
  });
});
