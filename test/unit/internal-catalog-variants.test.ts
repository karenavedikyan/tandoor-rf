import assert from "node:assert/strict";
import { it } from "node:test";
import { productFamilies, productSize, productModelName } from "../../src/internal-catalog/variants";
import { buildCatalogContext } from "../../src/internal-catalog/presentation";
import { avallonSizeVariantsFixture, sizeVariantsFixture, fixtureGuid as g } from "../helpers/internal-catalog-fixtures";
const context = (prices = [100, 100, 100, 100]) => buildCatalogContext(prices.map((price, i) => ({
  file_key: "prices", imported_at: "2026-11-14T08:00:00Z",
  record: { guid: g(i + 1), type_price: [{ guid: g(800), name: "РРЦ Тандор", price }] },
})));
it("groups source-linked equal-price sizes in numeric order, preserving each original GUID", () => {
  const products = sizeVariantsFixture(), families = productFamilies(products, context(), g(800));
  assert.equal(families.length, 1);
  assert.equal(families[0].modelName, "400 белый ПЭТ ДГ");
  assert.deepEqual(families[0].products.map(productSize), ["2000×600", "2000×700", "2000×800", "2000×900"]);
  assert.deepEqual(products.map(x => x.guid), families[0].products.map(x => x.guid));
  assert.match(products[0].name, /2000\*600/);
});
it("separates different prices, missing/invalid price types and unknown prices", () => {
  assert.equal(productFamilies(sizeVariantsFixture(), context([100, 100, 200, 200]), g(800)).length, 2);
  for (const type of ["", g(899)]) assert.equal(productFamilies(sizeVariantsFixture(), context(), type).length, 4);
  const c = context(); c.commerce.get(g(2))!.prices[0].conflict = true;
  assert.equal(productFamilies(sizeVariantsFixture(), c, g(800)).length, 2);
});
it("groups equal names and prices regardless of source links and properties, but keeps different names", () => {
  for (const name of ["СсылкаНаГлавную", "Цвет", "Покрытие двери"]) {
    const products = sizeVariantsFixture();
    products[1].properties.find(x => x.name === name)!.value = name === "СсылкаНаГлавную" ? "" : "Иное";
    assert.equal(productFamilies(products, context(), g(800)).length, 1, name);
  }
  const products = sizeVariantsFixture(); products[1].name = products[1].name.replace("400", "422");
  assert.equal(productFamilies(products, context(), g(800)).length, 2);
});
it("groups duplicate sizes without dropping either GUID, but keeps different model names", () => {
  const products = sizeVariantsFixture();
  products[1].name = products[0].name;
  products[1].properties.find(x => x.name === "Размер, мм")!.value = "2000х600";
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
  assert.equal(productFamilies(products, context(), g(800))[0].products.length, 4);
  const other = sizeVariantsFixture(); other[0].name = "400 образец";
  assert.equal(productFamilies(other, context(), g(800)).length, 2);
});
it("does not confuse a technical main-product marker with a different physical configuration", () => {
  const products = sizeVariantsFixture();
  products[1].properties.push({ guid: g(990), name: "Главная", value: "Да" },
    { guid: g(991), name: "главная (бот)", value: "Да" });
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
});
it("groups missing non-conflicting attributes and technical site aliases without filling source gaps", () => {
  const products = sizeVariantsFixture();
  products.forEach((p, i) => {
    if (i !== 1) p.properties.push({ guid: g(992), name: "Стекло", value: "Зеркало бронза фацет" });
    p.properties.push({ guid: g(993), name: "Название для сайта", value: i === 2 ? "400/6" : "400" });
  });
  const before = JSON.stringify(products);
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
  assert.equal(products[1].properties.some(p => p.name === "Стекло"), false);
  assert.equal(JSON.stringify(products), before);
});
it("keeps conflicting and unknown attributes on selected variants, not in the grouping identity", () => {
  const products = sizeVariantsFixture();
  for (const i of [0, 2, 3]) products[i].properties.push({
    guid: g(992), name: "Стекло", value: i === 3 ? "Прозрачное" : "Бронза",
  });
  for (const input of [products, [...products].reverse()]) {
    const families = productFamilies(input, context(), g(800));
    assert.equal(families.length, 1);
    assert.deepEqual(families[0].products.map(p => p.guid), [g(1), g(2), g(3), g(4)]);
  }
});
it("keeps per-SKU stock, arrivals, promotions, warranty and operating text out of physical identity", () => {
  const products = sizeVariantsFixture();
  products.forEach((p, i) => {
    ["Актуальный остаток", "Дата ожидаемого поступления", "Количество ожидаемого поступления",
      "Гарантийный срок", "Условия эксплуатации", "Новинка", "Хит продаж", "Акция",
      "АкцияДействуетС_Тандор_ОПТ", "АкцияДействуетДо_Оптовик"].forEach((name, n) =>
      p.properties.push({ guid: g(950 + n), name, value: "Исходное значение SKU " + i }));
  });
  const before = JSON.stringify(products);
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
  assert.equal(JSON.stringify(products), before);
  for (const name of ["Сторона открывания", "Вид утеплителя", "Комплектующие", "Глазок", "Стекло", "Стеклопакет"]) {
    const copy = structuredClone(products);
    copy.forEach((p, i) => p.properties.push({ guid: g(980), name, value: i < 2 ? "Исполнение А" : "Исполнение Б" }));
    assert.equal(productFamilies(copy, context(), g(800)).length, 1, name);
  }
});
it("groups Avallon melange left sizes despite the legacy glass checkbox, without altering either SKU", () => {
  const products = avallonSizeVariantsFixture(), before = JSON.stringify(products);
  const families = productFamilies(products, context([57900, 57900]), g(800));
  assert.equal(families.length, 1);
  assert.equal(families[0].modelName, "Аваллон мет/мет меланж левая");
  assert.deepEqual(families[0].products.map(productSize), ["850×2030", "950×2030"]);
  assert.deepEqual(families[0].products.map(p => p.properties.find(x => x.name === "ВХ. Стеклопакет")!.value), ["да", "нет"]);
  assert.equal(JSON.stringify(products), before);
  const right = structuredClone(products);
  right[1].properties.find(p => p.name === "Сторона открывания")!.value = "Правое";
  assert.equal(productFamilies(right, context([57900, 57900]), g(800)).length, 1);
  right[1].name = right[1].name.replace("левая", "правая");
  assert.equal(productFamilies(right, context([57900, 57900]), g(800)).length, 2);
  assert.equal(productFamilies(products, context([57900, 58000]), g(800)).length, 2);
});
it("ignores service classifications and formatting but preserves the original selected-size data", () => {
  const products = sizeVariantsFixture();
  products.forEach((product, i) => {
    product.properties.find(p => p.name === "Цвет")!.value = i % 2 ? "  БЕЛЫЙ  " : "белый";
    ["Тип товара", "сайт Тандор", "СсылкаНаГлавнуюNEW", "Цветовая гамма"].forEach((name, n) =>
      product.properties.push({ guid: g(960 + n), name, value: i % 2 ? "Светлая" : "Белая" }));
  });
  const before = JSON.stringify(products);
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
  assert.equal(JSON.stringify(products), before);
});
it("does not split equal-name cards for missing, ambiguous or different color attributes", () => {
  for (const kind of ["missing", "ambiguous", "different"]) {
    const products = sizeVariantsFixture();
    products.forEach((product, i) =>
      product.properties.push({ guid: g(990), name: "Цветовая гамма", value: i < 2 ? "Белая" : "Светлая" }));
    if (kind === "missing") products[1].properties = products[1].properties.filter(p => p.name !== "Цвет");
    if (kind === "ambiguous") products[1].properties.push({ guid: g(204), name: "Цвет", value: "Серый" });
    if (kind === "different") products[1].properties.find(p => p.name === "Цвет")!.value = "Серый";
    assert.equal(productFamilies(products, context(), g(800)).length, 1, kind);
  }
});
it("keeps site ranges and exact thickness as variant data, even when they differ", () => {
  for (const [range, exact] of [
    ["МТ. Толщина полотна (сайт)", "Толщина полотна, мм"],
    ["МТ. Толщина стали (сайт)", "Толщина стали, мм"],
  ]) {
    const products = sizeVariantsFixture();
    products.forEach((product, i) => product.properties.push(
      { guid: g(990), name: range, value: i % 2 ? "Диапазон А" : "Диапазон Б" },
      { guid: g(991), name: exact, value: "92" }));
    assert.equal(productFamilies(products, context(), g(800)).length, 1, range);
    products[1].properties.find(p => p.name === exact)!.value = "100";
    assert.equal(productFamilies(products, context(), g(800)).length, 1, exact);
  }
});
it("groups 500 Zefir despite the source accessory flag, without changing any original data", () => {
  const products = sizeVariantsFixture().map((p, i) => ({
    ...p, name: `500 Зефир ДГ 2000*${600 + i * 100} кромка черная с 4х сторон/замок черный`,
    properties: [...p.properties, { guid: g(999), name: "Комплектующие", value: "#plinth!" + (i === 3 ? 0 : 1) }],
  }));
  const before = JSON.stringify(products), families = productFamilies(products, context(), g(800));
  assert.equal(families.length, 1);
  assert.equal(families[0].modelName, "500 Зефир ДГ кромка черная с 4х сторон/замок черный");
  assert.equal(families[0].products.length, 4);
  assert.equal(JSON.stringify(products), before);
});
it("does not require shared sections, group, properties, articles or source links", () => {
  const products = sizeVariantsFixture();
  products.forEach((p, i) => {
    p.guid_group = g(500 + i);
    p.chapter = [{ guid: g(600 + i), name: "Раздел " + i }];
    p.properties = p.properties.filter(v => v.name !== "СсылкаНаГлавную");
  });
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
});
it("groups identical size-less names and recognizes dimensions even without a source size property", () => {
  const products = sizeVariantsFixture();
  products.forEach(p => { p.name = "Одинаковое название"; p.properties = []; });
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
  products.forEach((p, i) => { p.name = `Invisible.2000*${600 + i * 100}.АЛ4/грунт`; });
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
  assert.equal(productModelName(products[0]), "Invisible..АЛ4/грунт");
});
it("normalizes dimension notation, whitespace, case and ё only for identity, not source values", () => {
  const products = sizeVariantsFixture();
  const names = ["500 Зефир ДГ (2000 х 600)", "500 ЗЕФИР ДГ [2000X700]", " 500  Зефир ДГ 2000×800 ", "500 Зефир ДГ 2000*900"];
  products.forEach((p, i) => { p.name = names[i]; });
  assert.equal(productFamilies(products, context(), g(800)).length, 1);
  assert.deepEqual(products.map(p => p.name), names);
  assert.equal(productModelName({ ...products[0], name: "Плинтус 80*10*2070 зефир" }), "Плинтус зефир");
  assert.equal(productModelName({ ...products[0], name: "500 Зефир 20,5×60,5" }), "500 Зефир");
  assert.equal(productModelName({ ...products[0], name: "422 белый" }), "422 белый");
});
it("keeps unknown/conflicting prices separate, allows known zero and never mixes selected price types", () => {
  const products = sizeVariantsFixture(), c = context([0, 0, 100, 100]);
  assert.equal(productFamilies(products, c, g(800)).length, 2);
  c.commerce.get(g(3))!.prices[0].value = null;
  c.commerce.get(g(4))!.prices[0].conflict = true;
  assert.equal(productFamilies(products, c, g(800)).length, 3);
  assert.equal(productFamilies(products, c, g(801)).length, 4);
});
