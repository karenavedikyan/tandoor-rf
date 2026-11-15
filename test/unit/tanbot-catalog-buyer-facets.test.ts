import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Product } from "../../src/internal-catalog/model";
import { buyerFields, buyerValues } from "../../src/tanbot/catalog-buyer-facets";
import { catalogModels } from "../../src/tanbot/catalog-models";
import { CATALOG_BOT_SECTIONS } from "../../src/tanbot/catalog";

const product = (category: number, properties: [string, string][] = []): Product => ({
  guid: "00000000-0000-4000-8000-000000000010",
  name: "Для дома со стеклом белая 900х2050 левая",
  chapter: [], guid_group: CATALOG_BOT_SECTIONS[category].guid,
  name_group: CATALOG_BOT_SECTIONS[category].name,
  files: [{ guid: "00000000-0000-4000-8000-000000000011", name: "private", path: "a.jpg" }],
  properties: properties.map(([name, value]) => ({ guid: "00000000-0000-4000-8000-000000000012", name, value })),
});
describe("bot buyer facets and visual model identity", () => {
  it("offers at most four relevant fields, never sizes/handing or the whole technical catalogue", () => {
    assert.deepEqual(buyerFields(CATALOG_BOT_SECTIONS[0].guid), ["Назначение", "Цвет", "Остекление", "Терморазрыв"]);
    assert.deepEqual(buyerFields(CATALOG_BOT_SECTIONS[1].guid), ["Цвет", "Остекление", "Покрытие"]);
    assert.deepEqual(buyerFields(CATALOG_BOT_SECTIONS[2].guid), ["Тип фурнитуры", "Цвет", "Материал"]);
    for (const s of CATALOG_BOT_SECTIONS) assert.ok(buyerFields(s.guid).length <= 4);
  });
  it("uses explicit purpose tokens, including a source item suitable for both destinations", () => {
    const p = product(0, [["ВХ. По назначению", "для дома/для квартиры"]]);
    assert.deepEqual(buyerValues(p, "Назначение"), ["Для дома", "Для квартиры"]);
    assert.deepEqual(buyerValues(product(0), "Назначение"), []);
    assert.deepEqual(buyerValues(product(0, [["ВХ. По назначению", "не для дома"]]), "Назначение"), []);
    assert.deepEqual(buyerValues(product(1, p.properties.map(v => [v.name, v.value])), "Назначение"), []);
  });
  it("maps broad source colours to one simple palette, falling back only to explicit colour", () => {
    assert.deepEqual(buyerValues(product(0, [["Цветовая гамма", "БеЛаЯ"], ["Цвет", "Белая эмаль матовая"]]), "Цвет"), ["Белый"]);
    assert.deepEqual(buyerValues(product(1, [["Цветовая гамма", "Тёмная"]]), "Цвет"), ["Тёмный"]);
    assert.deepEqual(buyerValues(product(2, [["Цвет", "Хром/Никель"]]), "Цвет"), ["Хром/Никель"]);
    assert.deepEqual(buyerValues(product(0), "Цвет"), []);
  });
  it("uses the catalogue's specific door coating for every value, with a legacy fallback only when absent", () => {
    for (const coating of ["ПЭТ", "ПВХ", "Эмалит", "Эмалекс", "Soft touch", "Массив Ольхи", "Шпон Дуба"]) {
      assert.deepEqual(buyerValues(product(1, [
        ["Покрытие", "Современные покрытия"], ["Покрытие двери", coating],
      ]), "Покрытие"), [coating]);
    }
    for (const missing of ["", "-", "не указано"]) {
      assert.deepEqual(buyerValues(product(1, [
        ["Покрытие", "Шпон"], ["Покрытие двери", missing],
      ]), "Покрытие"), ["Шпон"]);
    }
    assert.deepEqual(buyerValues(product(1, [["Покрытие двери", "ПЭТ"]]), "Покрытие"), ["ПЭТ"]);
    assert.deepEqual(buyerValues(product(1), "Покрытие"), []);
  });
  it("glass is based on explicit entry glazing or interior classification, never product words", () => {
    for (const [source, label] of [["да", "Со стеклом"], ["нет", "Без стекла"]]) {
      assert.deepEqual(buyerValues(product(0, [["ВХ. Стеклопакет", source]]), "Остекление"), [label]);
    }
    for (const [source, label] of [["Глухая (ДГ)", "Без стекла"], ["Стеклянная (ДО)", "Со стеклом"],
      ["Частично остеклённая (ДЧ)", "Со стеклом"]]) {
      assert.deepEqual(buyerValues(product(1, [["Вид двери", source]]), "Остекление"), [label]);
    }
    assert.deepEqual(buyerValues(product(0), "Остекление"), []);
    assert.deepEqual(buyerValues(product(1, [["Вид двери", "-"]]), "Остекление"), []);
    assert.deepEqual(buyerValues(product(0, [["ВХ. Стеклопакет", "да"], ["ВХ. Стеклопакет", "нет"]]), "Остекление"), []);
    assert.deepEqual(buyerValues(product(1, [["Вид двери", "Глухая (ДГ)"], ["Вид двери", "Стеклянная (ДО)"]]), "Остекление"), []);
  });
  it("unknown thermal insulation is not advertised as absent or present", () => {
    assert.deepEqual(buyerValues(product(0, [["ВХ. Терморазрыв", "да"]]), "Терморазрыв"), ["С терморазрывом"]);
    assert.deepEqual(buyerValues(product(0, [["ВХ. Терморазрыв", "нет"]]), "Терморазрыв"), ["Без терморазрыва"]);
    assert.deepEqual(buyerValues(product(0), "Терморазрыв"), []);
    assert.deepEqual(buyerValues(product(0, [["ВХ. Терморазрыв", "неизвестно"]]), "Терморазрыв"), []);
    assert.deepEqual(buyerValues(product(1, [["ВХ. Терморазрыв", "да"]]), "Терморазрыв"), []);
  });
  it("deduplicates shared images across sizes/handing while retaining exact original image owners", () => {
    const a = product(0), b = { ...a, guid: "00000000-0000-4000-8000-000000000020",
      name: "Для дома со стеклом белая 1000х2050 правая",
      files: [...a.files, { ...a.files[0], guid: "00000000-0000-4000-8000-000000000021", path: "b.jpg" }] };
    const original = JSON.stringify([a, b]), models = catalogModels([b, a]);
    assert.equal(models.length, 1);
    assert.equal(models[0].name, "Для дома со стеклом белая");
    assert.equal(models[0].photos.length, 2);
    assert.equal(models[0].photos[0].product.guid, a.guid);
    assert.equal(models[0].photos[1].product.guid, b.guid);
    assert.equal(JSON.stringify([a, b]), original);
    const differentlyNamed = { ...b, name: "Другая модель 90R 1000х2050 правая" };
    assert.equal(catalogModels([differentlyNamed])[0].name, "Другая модель 90R");
    assert.equal(catalogModels([a, differentlyNamed]).length, 2);
  });
});
