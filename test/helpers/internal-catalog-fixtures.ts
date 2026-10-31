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
