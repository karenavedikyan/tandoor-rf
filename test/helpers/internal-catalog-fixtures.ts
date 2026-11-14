import type { Product } from "../../src/internal-catalog/model";
export function fixtureGuid(n: number): string { return "10000000-0000-4000-8000-" + n.toString(16).padStart(12, "0"); }
export function catalogueFixture(count = 30): Product[] {
  return Array.from({ length: count }, (_, index) => ({
    guid: fixtureGuid(index + 1),
    name: index === 0 ? "Ёлка 100%_ A/B" : "Товар " + String(index + 1).padStart(3, "0"),
    chapter: [{ guid: fixtureGuid(100 + index % 2), name: index % 2 ? "Плитка" : "Ламинат" }],
    properties: [
      { guid: fixtureGuid(200), name: "Бренд", value: index % 2 ? "Бета" : "Альфа" },
      { guid: fixtureGuid(201), name: "Артикул", value: "ART-" + (index + 1) },
      { guid: fixtureGuid(202), name: "Описание", value: index === 0 ? "а".repeat(1024) : "  Значение\u00a0с пробелами  " },
    ],
    files: index === 0 ? [{ guid: fixtureGuid(300), name: "Фото товара", path: "20240626\\photo.jpg" }] : [],
  }));
}
export function sizeVariantsFixture(): Product[] {
  return [600, 700, 800, 900].map((width, index) => ({
    guid: fixtureGuid(index + 1), name: `400 белый ПЭТ ДГ 2000*${width}`,
    guid_group: fixtureGuid(810), chapter: [{ guid: fixtureGuid(100), name: "Двери" }],
    properties: [
      { guid: fixtureGuid(201), name: "Артикул", value: "SIZE-" + width },
      { guid: fixtureGuid(202), name: "Размер, мм", value: "2000х" + width },
      { guid: fixtureGuid(203), name: "СсылкаНаГлавную", value: "model-400-white" },
      { guid: fixtureGuid(204), name: "Цвет", value: "Белый" },
      { guid: fixtureGuid(205), name: "Покрытие двери", value: "ПЭТ" },
    ],
    files: [{ guid: fixtureGuid(300 + index), name: "Фото " + width, path: width + ".jpg" }],
  }));
}
export function avallonSizeVariantsFixture(): Product[] {
  return sizeVariantsFixture().slice(0, 2).map((product, index) => ({
    ...product,
    name: `Аваллон мет/мет меланж ${index === 0 ? 850 : 950}х2030 левая`,
    properties: product.properties.map(p => ({
      ...p, value: p.name === "Размер, мм" ? `${index === 0 ? 850 : 950}x2030` :
        p.name === "СсылкаНаГлавную" ? "3e28a681-44d9-11e6-80c0-avallonbezstekla" :
        p.name === "Цвет" ? "Муар черный_Муар меланж" :
        p.name === "Покрытие двери" ? "Муар меланж / Муар черный" : p.value,
    })).concat([
      { guid: fixtureGuid(980), name: "Сторона открывания", value: "Левое" },
      { guid: fixtureGuid(981), name: "ВХ. Стеклопакет", value: index === 0 ? "да" : "нет" },
    ]),
  }));
}
export function zefirSizeVariantsFixture(): Product[] {
  return sizeVariantsFixture().map((p, i) => ({
    ...p, name: `500 Зефир ДГ 2000*${600 + i * 100} кромка черная с 4х сторон/замок черный`,
    properties: p.properties.concat([
      { guid: fixtureGuid(999), name: "Комплектующие", value: "#plinth!" + (i === 3 ? 0 : 1) },
    ]),
  }));
}
