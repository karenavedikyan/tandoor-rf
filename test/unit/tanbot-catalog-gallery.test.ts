import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCatalogBotReply, catalogCallback, CATALOG_BOT_SECTIONS, readCatalogGallery,
  type CatalogBotReply, type CatalogView } from "../../src/tanbot/catalog";
import { buildCatalogBrowseReply, type CatalogBrowseState } from "../../src/tanbot/catalog-browse";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(): CatalogView {
  return { snapshotId: id(900), context: { groups: [], commerce: new Map(), priceTypes: [] },
    products: [0, 1, 2].map(i => ({
      guid: id(i + 1), name: `Дипломат исполнение ${i}`, chapter: [],
      guid_group: id(500), name_group: "Входные двери",
      properties: [["Название для сайта", i === 2 ? "Другая модель" : "Дипломат"],
        ["Цвет", i ? "Чёрный" : "Белый"]].map(([name, value], j) => ({ guid: id(600 + j), name, value })),
      files: [{ guid: id(700 + i * 2), name: "PRIVATE", path: "private/external.jpg" },
        { guid: id(701 + i * 2), name: "PRIVATE", path: `private/panel-${i}.jpg` }],
    })) };
}
function choices(r: CatalogBotReply) {
  return r.inlineButtons ? r.inlineButtons.flat().map(b => ({ text: b.text, data: "payload" in b ? b.payload : "" })) :
    (r.replyMarkup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat()
      .map(b => ({ text: b.text, data: b.callback_data }));
}
describe("automatic complete model galleries", () => {
  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: one model click contains exterior + all panels, without repeated source paths`, () => {
      const v = fixture(), before = JSON.stringify(v);
      const r = buildCatalogBotReply(channel, v, catalogCallback("p", v.snapshotId, id(1)));
      assert.equal(r.text, "Дипломат");
      assert.deepEqual(readCatalogGallery(r.replyExtra)?.map(p => [p.productGuid, p.fileGuid]),
        [[id(1), id(700)], [id(1), id(701)], [id(2), id(703)]]);
      assert.ok(!choices(r).some(b => /Следующее фото|Предыдущее фото/.test(b.text)));
      assert.doesNotMatch(JSON.stringify(r), /PRIVATE|private\//);
      assert.equal(JSON.stringify(v), before);
    });
    it(`${channel}: colour selects the model but does not hide its other panels; back retains filters`, () => {
      const v = fixture();
      let r = buildCatalogBrowseReply(channel, v, { state: null, text: null,
        callback: catalogCallback("g", v.snapshotId, CATALOG_BOT_SECTIONS[0].guid) });
      const click = (label: string) => {
        const b = choices(r).find(x => x.text === label); assert.ok(b, label);
        r = buildCatalogBrowseReply(channel, v, { state: r.replyExtra.catalogBrowse as CatalogBrowseState,
          text: null, callback: b.data });
      };
      click("Фильтры"); click("Цвет"); click("Белый");
      assert.ok(!choices(r).some(b => b.text === "Другая модель"));
      click("Дипломат");
      assert.equal(readCatalogGallery(r.replyExtra)?.length, 3);
      assert.ok(readCatalogGallery(r.replyExtra)?.some(p => p.productGuid === id(2)));
      assert.ok(!readCatalogGallery(r.replyExtra)?.some(p => p.productGuid === id(3)));
      click("К моделям");
      assert.match(r.text, /Цвет: белый/);
      assert.ok(!choices(r).some(b => b.text === "Другая модель"));
    });
  }
  it("rejects malformed, cross-snapshot and oversized queues instead of trusting their identifiers", () => {
    const r = buildCatalogBotReply("max", fixture(), catalogCallback("p", id(900), id(1)));
    assert.equal(readCatalogGallery({}), null);
    assert.equal(readCatalogGallery({ ...r.replyExtra, catalogGallery: [{}] }), null);
    const photos = readCatalogGallery(r.replyExtra)!;
    assert.equal(readCatalogGallery({ ...r.replyExtra, catalogGallery: [
      photos[0], { ...photos[1], snapshotId: id(901) }] }), null);
    assert.equal(readCatalogGallery({ ...r.replyExtra, catalogGallery: Array(4097).fill(photos[0]) }), null);
  });
});
