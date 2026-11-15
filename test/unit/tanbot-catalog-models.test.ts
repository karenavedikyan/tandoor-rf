import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Product } from "../../src/internal-catalog/model";
import { catalogModelName, catalogModels } from "../../src/tanbot/catalog-models";
import { buildCatalogBrowseReply, type CatalogBrowseState } from "../../src/tanbot/catalog-browse";
import { catalogCallback, CATALOG_BOT_SECTIONS, readCatalogPhoto, type CatalogBotReply, type CatalogView } from "../../src/tanbot/catalog";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function product(n: number, model: string | null, name: string, colour = "Белый"): Product {
  return { guid: id(n), name, chapter: [], guid_group: CATALOG_BOT_SECTIONS[0].guid,
    name_group: "Входные двери", properties: [
      ...(model === null ? [] : [{ guid: id(100), name: "Название для сайта", value: model }]),
      { guid: id(101), name: "Цвет", value: colour },
    ], files: [{ guid: id(200 + n), name: "private", path: `private/${n}.jpg` }] };
}
function choices(reply: CatalogBotReply) {
  if (reply.inlineButtons) return reply.inlineButtons.flat().map(b => ({ text: b.text, data: "payload" in b ? b.payload : "" }));
  return (reply.replyMarkup as { inline_keyboard: { text: string; callback_data: string }[][] })
    .inline_keyboard.flat().map(b => ({ text: b.text, data: b.callback_data }));
}
function fixture(): CatalogView {
  return { snapshotId: id(900), context: { groups: [], priceTypes: [], commerce: new Map() },
    products: [
      product(1, "Астра", "Астра Белая шагрень / Белый матовый 860х2050 левая"),
      product(2, "Астра", "Астра Черная шагрень / Венге 960х2050 правая", "Чёрный"),
      product(3, "Астра", "Астра Венге / Белый матовый 960х2050 левая"),
      product(4, "Александрия-2", "Александрия-2 (5,5мм) (эмаль слон.кость патина золото) Г4"),
    ] };
}

describe("explicit base model identity, bot projection only", () => {
  it("groups different finishes, handing and sizes using the website title without changing originals", () => {
    const v = fixture(), original = JSON.stringify(v);
    const models = catalogModels(v.products);
    assert.equal(models.length, 2);
    const astra = models.find(m => m.name === "Астра")!;
    assert.deepEqual(astra.products.map(p => p.guid), [1, 2, 3].map(id));
    assert.deepEqual(astra.photos.map(p => [p.product.guid, p.file.guid]),
      [1, 2, 3].map(n => [id(n), id(200 + n)]));
    assert.equal(JSON.stringify(v), original);
  });
  it("keeps actual model numbers and hardware codes; only dimension tuples are removed", () => {
    for (const model of ["500", "Александрия-2", "Астра 2200", "Завертка Code Deco WC-2207-BLM"]) {
      assert.equal(catalogModelName(product(1, model, "Полное имя 860х2050 левая")), model);
    }
    assert.equal(catalogModelName(product(1, "Астра 860х2050", "Полное имя")), "Астра");
    assert.notEqual(catalogModelName(product(1, "Александрия-2", "x")),
      catalogModelName(product(2, "Александрия-3", "x")));
  });
  it("normalizes website names and keeps categories separate", () => {
    const a = product(1, "  Астра\u00a0 ", "x"), b = product(2, "АСТРА", "y");
    assert.equal(catalogModels([a, b]).length, 1);
    b.guid_group = CATALOG_BOT_SECTIONS[1].guid;
    b.name_group = CATALOG_BOT_SECTIONS[1].name;
    assert.equal(catalogModels([a, b]).length, 2);
  });
  it("uses the conservative existing fallback for absent, blank or conflicting website names", () => {
    const a = product(1, null, "Зефир Белый 2000х800 правая");
    assert.equal(catalogModelName(a), "Зефир Белый");
    a.properties.push({ guid: id(100), name: "Название для сайта", value: " " });
    assert.equal(catalogModelName(a), "Зефир Белый");
    a.properties.push({ guid: id(102), name: "Название для сайта", value: "Зефир" },
      { guid: id(103), name: "Название для сайта", value: "Другая модель" });
    assert.equal(catalogModelName(a), "Зефир Белый");
    assert.equal(catalogModelName(product(2, "Александрия-2", "Александрия-2 ... Г4")), "Александрия-2");
  });
  for (const channel of ["telegram", "max"] as const) {
    it(`${channel}: one model button, name-only search/caption and all matching photo owners`, () => {
      const v = fixture(), original = JSON.stringify(v);
      const open = () => buildCatalogBrowseReply(channel, v, { text: null, state: null,
        callback: catalogCallback("g", v.snapshotId, CATALOG_BOT_SECTIONS[0].guid) });
      const click = (r: CatalogBotReply, text: string) => {
        const c = choices(r).find(c => c.text === text);
        assert.ok(c, `missing ${text}: ${choices(r).map(c => c.text).join(", ")}`);
        return buildCatalogBrowseReply(channel, v, { text: null, callback: c.data,
          state: r.replyExtra.catalogBrowse as CatalogBrowseState });
      };
      let r = open();
      assert.match(r.text, /Моделей с фото: 2\./);
      assert.equal(choices(r).filter(c => c.text === "Астра").length, 1);
      r = click(r, "Найти по названию");
      r = buildCatalogBrowseReply(channel, v, { text: "Астра", callback: null,
        state: r.replyExtra.catalogBrowse as CatalogBrowseState });
      assert.match(r.text, /Моделей с фото: 1\./);
      r = click(r, "Астра");
      for (const n of [1, 2, 3]) {
        assert.equal(r.text, "Астра");
        assert.equal(readCatalogPhoto(r.replyExtra)?.productGuid, id(n));
        assert.equal(readCatalogPhoto(r.replyExtra)?.fileGuid, id(200 + n));
        if (n < 3) r = click(r, "Следующее фото");
      }
      r = click(r, "К моделям");
      r = click(r, "Фильтры"); r = click(r, "Цвет"); r = click(r, "Белый");
      assert.equal(choices(r).filter(c => c.text === "Астра").length, 1);
      r = click(r, "Астра");
      assert.equal(readCatalogPhoto(r.replyExtra)?.productGuid, id(1));
      r = click(r, "Следующее фото");
      assert.equal(readCatalogPhoto(r.replyExtra)?.productGuid, id(3), "black variant excluded before grouping/gallery");
      assert.ok(!choices(r).some(c => c.text === "Следующее фото"));
      assert.equal(JSON.stringify(v), original);
      assert.doesNotMatch(JSON.stringify(r), /private\/|Белая шагрень|2050|правая|Закупка/);
    });
  }
});
