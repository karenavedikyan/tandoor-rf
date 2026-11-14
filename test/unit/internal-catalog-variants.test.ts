import assert from "node:assert/strict";
import { it } from "node:test";
import { productFamilies, productSize } from "../../src/internal-catalog/variants";
import { buildCatalogContext } from "../../src/internal-catalog/presentation";
import { sizeVariantsFixture, fixtureGuid as g } from "../helpers/internal-catalog-fixtures";
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
it("does not group look-alikes without a source link or with different finish/model/properties", () => {
  for (const name of ["СсылкаНаГлавную", "Цвет", "Покрытие двери"]) {
    const products = sizeVariantsFixture();
    products[1].properties.find(x => x.name === name)!.value = name === "СсылкаНаГлавную" ? "" : "Иное";
    assert.equal(productFamilies(products, context(), g(800)).length, 2, name);
  }
  const products = sizeVariantsFixture(); products[1].name = products[1].name.replace("400", "422");
  assert.equal(productFamilies(products, context(), g(800)).length, 2);
});
it("leaves ambiguous duplicate sizes and names that do not contain the source dimension separate", () => {
  const products = sizeVariantsFixture();
  products[1].name = products[0].name;
  products[1].properties.find(x => x.name === "Размер, мм")!.value = "2000х600";
  assert.equal(productFamilies(products, context(), g(800)).length, 4);
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
it("never uses an unknown attribute to bridge conflicting known configurations, regardless of order", () => {
  const products = sizeVariantsFixture();
  for (const i of [0, 2, 3]) products[i].properties.push({
    guid: g(992), name: "Стекло", value: i === 3 ? "Прозрачное" : "Бронза",
  });
  for (const input of [products, [...products].reverse()]) {
    const families = productFamilies(input, context(), g(800));
    assert.equal(families.length, 3);
    assert.deepEqual(families.find(f => f.products.length === 2)!.products.map(p => p.guid), [g(1), g(3)]);
    assert.equal(families.find(f => f.products.some(p => p.guid === g(2)))!.products.length, 1);
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
  for (const name of ["Сторона открывания", "Вид утеплителя", "Комплектующие", "Глазок", "ВХ. Стеклопакет"]) {
    const copy = structuredClone(products);
    copy.forEach((p, i) => p.properties.push({ guid: g(980), name, value: i < 2 ? "Исполнение А" : "Исполнение Б" }));
    assert.equal(productFamilies(copy, context(), g(800)).length, 2, name);
  }
});
