import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoolClient } from "pg";
import {
  buildCatalogBrowseReply, filteredCatalogView, isCatalogSearchText, readCatalogBrowseInput,
  type CatalogBrowseState,
} from "../../src/tanbot/catalog-browse";
import { catalogCallback, CATALOG_BOT_SECTIONS, restrictCatalogBotView, type CatalogView, type CatalogBotReply } from "../../src/tanbot/catalog";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const category = CATALOG_BOT_SECTIONS[0].guid;
function fixture(count = 20): CatalogView {
  return { snapshotId: id(1000), context: { groups: [], priceTypes: [], commerce: new Map() },
    products: Array.from({ length: count }, (_, i) => ({
      guid: id(i + 1), name: i ? `Модель ${String(i + 1).padStart(2, "0")}` : "Ёлка 01",
      chapter: [], guid_group: category, name_group: "Входные двери",
      properties: [
        { guid: id(101), name: "Цвет", value: i % 2 ? "Чёрный" : "Белый" },
        { guid: id(102), name: "Размер, мм", value: i % 3 ? "800х2000" : "900х2000" },
        { guid: id(103), name: "Сторона открывания", value: i % 4 ? "Правая" : "Левая" },
        { guid: id(104), name: "Закрытая маржа", value: "СЕКРЕТ ПОСТАВЩИКА" },
        { guid: id(105), name: "ВХ. По назначению", value: i % 3 ? "для квартиры" : "для дома" },
        { guid: id(106), name: "ВХ. Терморазрыв", value: i % 4 ? "нет" : "да" },
        { guid: id(107), name: "ВХ. Стеклопакет", value: i % 2 ? "нет" : "да" },
        { guid: id(108), name: "Вид двери", value: i % 2 ? "Глухая (ДГ)" : "Стеклянная (ДО)" },
      ],
      files: [1, 2].map(n => ({ guid: id(2000 + i * 2 + n), name: "private-file", path: `private/${i}-${n}.jpg` })),
    })) };
}
function choices(r: CatalogBotReply) {
  if (r.inlineButtons) return r.inlineButtons.flat().map(b => ({ text: b.text, data: "payload" in b ? b.payload : "" }));
  return (r.replyMarkup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard
    .flat().map(b => ({ text: b.text, data: b.callback_data }));
}
const state = (r: CatalogBotReply) => r.replyExtra.catalogBrowse as CatalogBrowseState;

describe("catalogue category filters and name search", () => {
  for (const channel of ["telegram", "max"] as const) {
    function open(v = fixture()) {
      return buildCatalogBrowseReply(channel, v, { text: null,
        callback: catalogCallback("g", v.snapshotId, category), state: null });
    }
    function click(r: CatalogBotReply, text: string, v = fixture()) {
      const button = choices(r).find(c => c.text === text);
      assert.ok(button, `Missing ${text}; got ${choices(r).map(c => c.text).join(", ")}`);
      return buildCatalogBrowseReply(channel, v, { text: null, callback: button.data, state: state(r) });
    }
    function apply(r: CatalogBotReply, field: string, value: string) {
      r = click(r, "Фильтры"); r = click(r, field); return click(r, value);
    }
    it(`${channel}: each of the three categories has its own filters and name search`, () => {
      for (const s of CATALOG_BOT_SECTIONS) {
        const v = fixture(4);
        v.products.forEach(p => { p.guid_group = s.guid; p.name_group = s.name; });
        let r = buildCatalogBrowseReply(channel, v, { text: null, state: null,
          callback: catalogCallback("g", v.snapshotId, s.guid) });
        assert.equal(state(r).category, s.guid);
        assert.ok(choices(r).some(c => c.text === "Фильтры"));
        r = click(r, "Найти по названию", v);
        r = buildCatalogBrowseReply(channel, v, { text: "елка", callback: null, state: state(r) });
        assert.equal(state(r).category, s.guid);
        assert.match(r.text, /Моделей с фото: 1\./);
      }
    });
    it(`${channel}: combines facets AND name, preserves selection through photos and reset`, () => {
      const v = fixture(), original = JSON.stringify(v);
      let r = apply(open(), "Цвет", "Белый");
      assert.equal(filteredCatalogView(restrictCatalogBotView(v), state(r)).products.length, 10);
      r = apply(r, "Назначение", "Для дома");
      assert.equal(filteredCatalogView(restrictCatalogBotView(v), state(r)).products.length, 4);
      r = apply(r, "Терморазрыв", "С терморазрывом");
      assert.equal(filteredCatalogView(restrictCatalogBotView(v), state(r)).products.length, 2);
      r = click(r, "Найти по названию");
      assert.ok(state(r).awaitingSearch);
      r = buildCatalogBrowseReply(channel, v, { text: "ЕЛКА", callback: null, state: state(r) });
      assert.equal(filteredCatalogView(restrictCatalogBotView(v), state(r)).products.length, 1);
      assert.equal(state(r).awaitingSearch, false);
      const model = choices(r).find(c => c.text.includes("Ёлка"))!;
      assert.ok(model);
      r = click(r, model.text);
      assert.equal((r.replyExtra.catalogPhoto as { productGuid: string }).productGuid, id(1));
      assert.equal(Object.keys(state(r).filters).length, 3);
      assert.equal(state(r).query, "ЕЛКА");
      assert.equal(r.text, "Ёлка 01", "photo caption contains only model name");
      assert.ok(!choices(r).some(c => c.text === "Фильтры"));
      r = click(r, "К моделям");
      r = click(r, "Фильтры"); r = click(r, "Выбрано: Цвет"); r = click(r, "Любое значение");
      assert.equal(state(r).filters["Цвет"], undefined);
      assert.equal(Object.keys(state(r).filters).length, 2);
      r = click(r, "Сбросить отбор");
      assert.deepEqual(state(r).filters, {}); assert.equal(state(r).query, "");
      assert.equal(filteredCatalogView(restrictCatalogBotView(v), state(r)).products.length, 20);
      assert.equal(JSON.stringify(v), original);
    });
    it(`${channel}: pagination and photo return keep the selected filters`, () => {
      let r = apply(open(), "Цвет", "Чёрный");
      assert.match(r.text, /1 из 2/);
      r = click(r, "Далее");
      assert.match(r.text, /2 из 2/);
      const model = choices(r).find(c => c.text.includes("Модель"))!;
      r = click(r, model.text);
      assert.ok(r.replyExtra.catalogPhoto);
      // Follow the gallery's "back to models" action, preserving the facet.
      const back = choices(r).find(c => c.text.includes("модел"))!;
      assert.ok(back);
      r = click(r, back.text);
      assert.match(r.text, /2 из 2/);
      assert.equal(state(r).filters["Цвет"], "черный");
      assert.equal(filteredCatalogView(restrictCatalogBotView(fixture()), state(r)).products.length, 10);
    });
    it(`${channel}: search only names, handles no match, long input and cancel`, () => {
      let r = click(open(), "Найти по названию");
      const before = JSON.stringify(state(r));
      r = buildCatalogBrowseReply(channel, fixture(), { text: "Чёрный", callback: null, state: state(r) });
      assert.match(r.text, /не найдено/); assert.ok(!r.replyExtra.catalogPhoto);
      assert.notEqual(JSON.stringify(state(r)), before);
      r = click(r, "Найти по названию");
      r = buildCatalogBrowseReply(channel, fixture(), { text: "я".repeat(100), callback: null, state: state(r) });
      assert.ok(state(r).awaitingSearch); assert.match(r.text, /от 1 до 80/);
      r = click(r, "К моделям"); assert.equal(state(r).awaitingSearch, false);
      r = click(r, "Найти по названию");
      r = buildCatalogBrowseReply(channel, fixture(), { text: "Отмена", callback: null, state: state(r) });
      assert.equal(state(r).awaitingSearch, false); assert.equal(state(r).query, "Чёрный");
    });
    it(`${channel}: stale/forged callbacks cannot apply an action; snapshot changes reset`, () => {
      const r = open(), next = click(r, "Фильтры");
      const stale = buildCatalogBrowseReply(channel, fixture(), {
        text: null, callback: choices(r)[0].data, state: state(next),
      });
      assert.match(stale.text, /Кнопка устарела/);
      assert.deepEqual(state(stale).filters, {});
      const foreign = buildCatalogBrowseReply(channel, fixture(), {
        text: null, callback: choices(r)[0].data, state: null,
      });
      assert.equal(foreign.replyExtra.catalogBrowse, undefined);
      const changed = buildCatalogBrowseReply(channel, { ...fixture(), snapshotId: id(1001) }, {
        text: null, callback: choices(r)[0].data, state: state(r),
      });
      assert.match(changed.text, /каталог обновился/);
      assert.equal(changed.replyExtra.catalogBrowse, undefined);
    });
    it(`${channel}: facet pages are bounded; hidden data/photo-less or excluded SKUs never appear`, () => {
      const v = fixture(30);
      v.products.forEach((p, i) => { p.properties[0].value = `Тон ${i + 1}`; });
      v.products[0].files = [];
      v.products[1].name_group = "Напольные покрытия";
      let r = click(open(v), "Фильтры", v);
      assert.ok(!JSON.stringify(r).includes("Закрытая маржа"));
      r = click(r, "Цвет", v);
      assert.ok(!choices(r).some(c => ["Тон 1", "Тон 2"].includes(c.text)));
      assert.equal(choices(r).filter(c => c.text.startsWith("Тон ")).length, 8);
      r = click(r, "Далее", v);
      assert.ok(choices(r).some(c => c.text === "Тон 11"));
      for (const c of choices(r)) assert.ok(Buffer.byteLength(c.data) <= 64);
      for (const secret of ["private/", "private-file", "СЕКРЕТ ПОСТАВЩИКА", "Закрытая маржа"]) {
        assert.ok(!JSON.stringify(r).includes(secret));
      }
    });
  }
  it("does not intercept tracker commands, invitations, codes, or arbitrary callbacks", async () => {
    for (const text of ["/start", "/code", "Получить код", "Получить код приёма", "Создать передачу",
      "Мои передачи", "Статус трека", "Настройки", "Продолжить оформление", "Main menu",
      "123456", "+7 (900) 123-45-67", "Приглашение https://lk.tandoor.ru/tan-tracker/recipient?mst=x"]) {
      assert.equal(isCatalogSearchText(text), false, text);
      const db = { query: () => { throw new Error("Unexpected search-state query"); } } as unknown as PoolClient;
      assert.equal(await readCatalogBrowseInput(db, "max", 1n, 2n, text), null);
    }
    assert.ok(isCatalogSearchText("Ёлка 900"));
    assert.ok(isCatalogSearchText("01"));
  });
  it("loads only the last committed reply, scoped to channel/chat/sender and TTL", async () => {
    const r = buildCatalogBrowseReply("max", fixture(), { text: null,
      callback: catalogCallback("g", id(1000), category), state: null });
    const saved = { ...state(r), awaitingSearch: true };
    for (const channel of ["max", "telegram"] as const) {
      const calls: { sql: string; values: string[] }[] = [];
      const db = { query: async (sql: string, values: string[]) => {
        calls.push({ sql, values }); return { rows: [{ state: saved }] };
      } } as unknown as PoolClient;
      assert.ok(await readCatalogBrowseInput(db, channel, 100n, channel === "telegram" ? 100n : 200n, "Ёлка"));
      assert.equal(calls.length, 1);
      assert.match(calls[0].sql, new RegExp(`FROM tanbot_${channel}_update_dedup`));
      assert.match(calls[0].sql, /LIMIT 1/); assert.match(calls[0].sql, /30 minutes/);
      assert.deepEqual(calls[0].values, channel === "max" ? ["100", "200"] : ["100"]);
      if (channel === "max") assert.match(calls[0].sql, /reply_user_id=\$2/);
    }
    const db = { query: async () => ({ rows: [{ state: null }] }) } as unknown as PoolClient;
    assert.equal(await readCatalogBrowseInput(db, "telegram", 100n, 200n, null, "cat2:0000000000000000:0"), null);
    assert.equal(await readCatalogBrowseInput(db, "max", 1n, 2n, "обычный текст"), null);
    assert.ok(await readCatalogBrowseInput(db, "max", 1n, 2n, null, "cat2:0000000000000000:0"));
  });
  it("old gallery state cannot reinterpret buttons after the catalogue-facet upgrade", async () => {
    const r = buildCatalogBrowseReply("max", fixture(), { text: null,
      callback: catalogCallback("g", id(1000), category), state: null });
    const previous = { ...state(r), version: 3, awaitingSearch: true };
    const db = { query: async () => ({ rows: [{ state: previous }] }) } as unknown as PoolClient;
    const input = await readCatalogBrowseInput(db, "max", 1n, 2n, null, choices(r)[0].data);
    assert.ok(input); assert.equal(input.state, null);
    assert.match(buildCatalogBrowseReply("max", fixture(), input).text, /Выберите категорию заново/);
    assert.equal(await readCatalogBrowseInput(db, "max", 1n, 2n, "обычный текст"), null);
  });
});
