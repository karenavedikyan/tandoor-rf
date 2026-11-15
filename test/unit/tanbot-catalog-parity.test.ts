import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSearch, type Product } from "../../src/internal-catalog/model";
import { buyerFields } from "../../src/tanbot/catalog-buyer-facets";
import { catalogModels } from "../../src/tanbot/catalog-models";
import { buildCatalogBrowseReply, filteredCatalogView, type CatalogBrowseState } from "../../src/tanbot/catalog-browse";
import { CATALOG_BOT_SECTIONS, catalogCallback, restrictCatalogBotView, readCatalogPhoto, readCatalogGallery,
  type CatalogBotReply, type CatalogView } from "../../src/tanbot/catalog";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Row = { product: Product; category: number; model: string; expected: Record<string, string[]> };
function fixture() {
  const rows: Row[] = [];
  const groups = ["МЕТАЛЛИЧЕСКИЕ ДВЕРИ", "МЕЖКОМНАТНЫЕ ДВЕРИ", "МЕЖКОМНАТКА фурнитура"]
    .flatMap((name, i) => [
      { guid: id(8000 + i), name, parent: null, conflict: false },
      { guid: id(8100 + i), name: "Стандарт", parent: id(8000 + i), conflict: false },
    ]);
  function add(category: number, model: string, source: [string, string][], expected: Row["expected"]) {
    const n = rows.length + 1;
    rows.push({ category, model, expected, product: {
      guid: id(n), name: `${model} исполнение ${n} 2000х${600 + n % 3 * 100}`,
      guid_group: id(8100 + category), name_group: "Стандарт", chapter: [],
      properties: [["Название для сайта", model], ...source].map(([name, value], i) =>
        ({ guid: id(10000 + i), name, value })),
      files: [{ guid: id(20000 + n), name: "private-source", path: `private/${n}.jpg` }],
    } });
  }
  // Observed catalogue coating vocabulary, not names guessed from SKU text.
  const coatings = ["Soft touch", "Vinyl", "Винил, долговеччый, практичный, влагостойкий,гибкий",
    "Грунт-плёнка", "Грунтованное", "Ламинированное покрытие", "Массив Ольхи", "Массив Сосны",
    "Морение", "ПВХ", "ПВХ-глянец", "ПЭТ", "Шпон Fine Line", "Шпон Дуба", "Экошпон",
    "Эмалекс", "Эмалит", "Эмаль"];
  coatings.forEach((coating, i) => {
    for (let variant = 0; variant < 2; variant++) {
      const colour = variant ? "Тёмный" : "Белый", glass = variant ? "Со стеклом" : "Без стекла";
      add(1, coating === "ПЭТ" ? "Деканто" : `Модель покрытия ${i}`, [
        ["Покрытие", "Современные покрытия"], ["Покрытие двери", coating],
        ["Тип погонажа", variant ? "Телескопический погонаж" : "Обычный погонаж"],
        ["Цветовая гамма", variant ? "Тёмная" : "Белая"], ["Цвет", "Детальная отделка"],
        ["Вид двери", variant ? "Частично остекленная (ДЧ)" : "Глухая (ДГ)"],
      ], { Покрытие: [coating], Цвет: [colour], Остекление: [glass] });
    }
  });
  for (let n = 0; n < 8; n++) {
    const purpose = n % 3 === 0 ? ["Для дома", "Для квартиры"] : n % 3 === 1 ? ["Для дома"] : ["Для квартиры"];
    add(0, `Входная ${n >> 1}`, [
      ["ВХ. По назначению", purpose.map(x => x.toLowerCase()).join("/")],
      ["ВХ. Терморазрыв", n % 2 ? "да" : "нет"], ["ВХ. Стеклопакет", n % 4 ? "нет" : "да"],
      ["Цветовая гамма", n % 2 ? "Серая" : "Коричневый"],
      ["Тип погонажа", "Телескопический погонаж"],
    ], { Назначение: purpose, Цвет: [n % 2 ? "Серый" : "Коричневый"],
      Терморазрыв: [n % 2 ? "С терморазрывом" : "Без терморазрыва"],
      Остекление: [n % 4 ? "Без стекла" : "Со стеклом"] });
  }
  for (const type of ["Ручка", "Петля", "Ключевой цилиндр"]) {
    for (const colour of ["Хром", "Золото"]) for (const material of ["ЦАМ", "Сталь"]) {
      add(2, `${type} WC-2207`, [["Тип фурнитуры", type], ["Цветовая гамма", colour],
        ["Материал", material]], { "Тип фурнитуры": [type], Цвет: [colour], Материал: [material] });
    }
  }
  // Independent expected selections include ungrouped variants and a real
  // hardware floor stop, not only records reachable through source groups.
  for (const category of [0, 1, 2]) {
    const source = rows.find(r => r.category === category)!;
    const copy = structuredClone(source);
    copy.product.guid = id(40000 + category);
    delete copy.product.guid_group; delete copy.product.name_group;
    copy.product.files = [{ guid: id(41000 + category), name: "private-source",
      path: `private/ungrouped-${category}.jpg` }];
    rows.push(copy);
  }
  add(2, "Ограничитель DS-0020", [["Тип фурнитуры", "Ограничитель"],
    ["Цвет", "Графит"], ["Материал", "Сталь"]],
  { "Тип фурнитуры": ["Ограничитель"], Цвет: ["Графит"], Материал: ["Сталь"] });
  rows.at(-1)!.product.chapter.push({ guid: id(42000), name: "Ограничители напольные" });
  const view: CatalogView = { snapshotId: id(9000), products: rows.map(x => x.product),
    context: { groups, commerce: new Map(), priceTypes: [] } };
  return { rows, view };
}
function choices(r: CatalogBotReply) {
  if (r.inlineButtons) return r.inlineButtons.flat().map(b => ({ text: b.text, data: "payload" in b ? b.payload : "" }));
  return (r.replyMarkup as { inline_keyboard: { text: string; callback_data: string }[][] })
    .inline_keyboard.flat().map(b => ({ text: b.text, data: b.callback_data }));
}

describe("catalogue parity across all buyer filters and categories", () => {
  for (let category = 0; category < CATALOG_BOT_SECTIONS.length; category++) {
    it(`${CATALOG_BOT_SECTIONS[category].name}: every facet value and pair of filters matches the independent SKU oracle`, () => {
      const { rows, view } = fixture(), before = JSON.stringify(view), projected = restrictCatalogBotView(view);
      assert.deepEqual(projected.products.map(p => p.guid), rows.map(x => x.product.guid));
      const source = rows.filter(r => r.category === category), section = CATALOG_BOT_SECTIONS[category].guid;
      const fields = buyerFields(section);
      const values = (field: string) => [...new Set(source.flatMap(r => r.expected[field] ?? []))];
      const check = (filters: Record<string, string>) => {
        const matches = source.filter(r => Object.entries(filters)
          .every(([f, v]) => r.expected[f]?.some(x => normalizeSearch(x) === v)));
        const filtered = filteredCatalogView(projected, { category: section, query: "", filters });
        assert.deepEqual(filtered.products.map(p => p.guid), matches.map(r => r.product.guid), JSON.stringify(filters));
        assert.deepEqual(catalogModels(filtered.products).map(x => x.name).sort(),
          [...new Set(matches.map(r => r.model))].sort(), JSON.stringify(filters));
      };
      check({});
      for (const field of fields) for (const value of values(field)) check({ [field]: normalizeSearch(value) });
      for (let a = 0; a < fields.length; a++) for (let b = a + 1; b < fields.length; b++) {
        for (const av of values(fields[a])) for (const bv of values(fields[b])) {
          check({ [fields[a]]: normalizeSearch(av), [fields[b]]: normalizeSearch(bv) });
        }
      }
      check({ [fields[0]]: "значение отсутствует в каталоге" });
      assert.equal(JSON.stringify(view), before, "original records, GUIDs and source properties stay unchanged");
    });
  }
  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: all coating values are reachable, PET models have one filtered photo and keep the selection on return`, () => {
      const { view } = fixture(), section = CATALOG_BOT_SECTIONS[1].guid;
      let r = buildCatalogBrowseReply(channel, view, { text: null, state: null,
        callback: catalogCallback("g", view.snapshotId, section) });
      const click = (label: string) => {
        const button = choices(r).find(x => x.text === label);
        assert.ok(button, `${label}: ${choices(r).map(x => x.text).join(", ")}`);
        r = buildCatalogBrowseReply(channel, view, { text: null, callback: button.data,
          state: r.replyExtra.catalogBrowse as CatalogBrowseState });
      };
      click("Фильтры"); click("Покрытие");
      const reached = new Set<string>();
      for (let page = 0; page < 3; page++) {
        for (const a of (r.replyExtra.catalogBrowse as CatalogBrowseState).actions) {
          if (a.kind === "pick" && a.value) reached.add(a.value);
        }
        if (choices(r).some(x => x.text === "Далее")) click("Далее");
      }
      assert.equal(reached.size, 18);
      click("К моделям"); click("Фильтры"); click("Покрытие");
      while (!choices(r).some(x => x.text === "ПЭТ")) click("Далее");
      click("ПЭТ");
      assert.match(r.text, /Моделей с фото: 1\./);
      assert.equal(choices(r).filter(x => x.text === "Деканто").length, 1);
      click("Деканто");
      const first = readCatalogPhoto(r.replyExtra); assert.ok(first);
      assert.equal(r.text, "Деканто");
      assert.equal(readCatalogGallery(r.replyExtra), null);
      assert.ok(filteredCatalogView(restrictCatalogBotView(view), {
        category: section, query: "", filters: { Покрытие: "пэт" },
      }).products.some(p => p.guid === first.productGuid));
      assert.ok(!choices(r).some(x => x.text === "Следующее фото"));
      click("К моделям");
      assert.match(r.text, /Покрытие: пэт/);
      assert.equal(choices(r).filter(x => x.text === "Деканто").length, 1);
      assert.ok(!JSON.stringify(r).includes("Современные покрытия"));
    });
  }
  it("compatible trim metadata does not allow actual trim/floors, conflicts, cycles or photo-less items", () => {
    const { view } = fixture(), original = view.products[0];
    const extras = Array.from({ length: 6 }, (_, i) => structuredClone({ ...original, guid: id(30000 + i) }));
    extras[0].name_group = "МЕЖКОМНАТНЫЕ ДВЕРИ ПОГОНАЖ";
    extras[1].chapter.push({ guid: id(31000), name: "Напольные покрытия" });
    extras[2].properties.push({ guid: id(31001), name: "Тип погонажа", value: "Наличник" });
    extras[3].files = [];
    extras[4].guid_group = id(32000);
    view.context.groups.push({ guid: id(32000), name: "Межкомнатные двери", parent: id(32000), conflict: false });
    extras[5].guid_group = id(32001);
    view.context.groups.push({ guid: id(32001), name: "Межкомнатные двери", parent: null, conflict: true });
    view.products.push(...extras);
    const before = JSON.stringify(view);
    const projected = restrictCatalogBotView(view);
    assert.ok(projected.products.some(p => p.guid === original.guid));
    assert.ok(!projected.products.some(p => extras.some(x => x.guid === p.guid)));
    assert.equal(JSON.stringify(view), before);
  });
  it("ungrouped fallback fails closed on unknown or contradictory properties and never overrides a source group", () => {
    const { view } = fixture();
    const make = (n: number, props: [string, string][]): Product => ({
      guid: id(50000 + n), name: "Входная межкомнатная дверь фурнитура",
      chapter: [], properties: props.map(([name, value], i) => ({ guid: id(51000 + i), name, value })),
      files: [{ guid: id(52000 + n), name: "private", path: `private/guard-${n}.jpg` }],
    });
    const rejected = [
      make(1, []),
      make(2, [["Тип фурнитуры", "не указано"], ["Вид двери", "-"]]),
      make(3, [["Тип фурнитуры", "Ручка"], ["Вид двери", "Глухая (ДГ)"]]),
      make(4, [["Вид двери", "Глухая"], ["ВХ. Терморазрыв", "нет"]]),
      { ...make(5, [["Тип фурнитуры", "Ручка"]]), guid_group: id(59999) },
      { ...make(6, [["Тип фурнитуры", "Ограничитель"]]), name_group: "Напольные покрытия" },
      { ...make(7, [["Тип фурнитуры", "Ограничитель"]]), name_group: "Ламинат" },
      { ...make(8, [["Тип фурнитуры", "Ручка"]]), name_group: "Напольные" },
      make(9, [["Вид двери", "Глухая"], ["Тип погонажа", "Наличник"]]),
    ];
    const accepted = [
      make(10, [["ВХ. Терморазрыв", "нет"]]),
      make(11, [["Вид двери", "Частично остекленная (ДЧ)"]]),
      { ...make(12, [["Тип фурнитуры", "Ограничитель"]]), name_group: "Напольные" },
    ];
    view.products = [...rejected, ...accepted];
    const before = JSON.stringify(view);
    const projected = restrictCatalogBotView(view);
    assert.deepEqual(projected.products.map(p => p.guid), accepted.map(p => p.guid));
    assert.deepEqual(projected.products.map(p => p.guid_group), CATALOG_BOT_SECTIONS.map(s => s.guid));
    assert.deepEqual(restrictCatalogBotView(projected), projected, "projection must be idempotent");
    assert.equal(JSON.stringify(view), before, "source records stay unchanged");
  });
});
