import { normalizeSearch, type Product } from "../internal-catalog/model";
import { CATALOG_BOT_SECTIONS } from "./catalog";

/** Deliberately small, category-specific buyer vocabulary, not the LK tech list. */
export const BUYER_FIELDS = ["Назначение", "Цвет", "Остекление", "Терморазрыв",
  "Покрытие", "Тип фурнитуры", "Материал"] as const;
export function buyerFields(category: string): readonly string[] {
  if (category === CATALOG_BOT_SECTIONS[0].guid) return ["Назначение", "Цвет", "Остекление", "Терморазрыв"];
  if (category === CATALOG_BOT_SECTIONS[1].guid) return ["Цвет", "Остекление", "Покрытие"];
  if (category === CATALOG_BOT_SECTIONS[2].guid) return ["Тип фурнитуры", "Цвет", "Материал"];
  return [];
}
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const meaningful = (s: string) => !!s && s.length <= 100 &&
  !["-", "нет", "не указан", "не указано", "не задан", "не задано"].includes(normalizeSearch(s));
function values(product: Product, field: string) {
  return product.properties.filter(p => p.name.trim() === field).map(p => clean(p.value));
}
const palette: Record<string, string> = {
  белая: "Белый", белый: "Белый", черная: "Чёрный", черный: "Чёрный",
  серая: "Серый", серый: "Серый", светлая: "Светлый", светлый: "Светлый",
  темная: "Тёмный", темный: "Тёмный", коричневая: "Коричневый", коричневый: "Коричневый",
};
const yesNo = (raw: string) => {
  const s = normalizeSearch(raw);
  return ["да", "истина", "true", "1"].includes(s) ? true :
    ["нет", "ложь", "false", "0"].includes(s) ? false : null;
};
function binary(product: Product, field: string, yes: string, no: string): string[] {
  const found = new Set(values(product, field).map(yesNo).filter(v => v !== null));
  return found.size === 1 ? [found.has(true) ? yes : no] : [];
}
export function buyerValues(product: Product, field: string): string[] {
  if (!buyerFields(product.guid_group ?? "").includes(field)) return [];
  if (field === "Назначение") {
    const source = values(product, "ВХ. По назначению").map(normalizeSearch);
    return [["Для дома", "для дома"], ["Для квартиры", "для квартиры"]]
      .filter(([, token]) => source.some(v => v.split(/\s*[/;,]\s*/).includes(token))).map(([label]) => label);
  }
  if (field === "Цвет") {
    const broad = values(product, "Цветовая гамма").filter(meaningful);
    return (broad.length ? broad : values(product, "Цвет").filter(meaningful))
      .map(v => palette[normalizeSearch(v)] ?? v);
  }
  if (field === "Покрытие") {
    // The catalogue's door-coating facet is specific (ПЭТ, Эмалит, ...).
    // "Покрытие" can instead contain the broad "Современные покрытия".
    // Use the same specific field for every coating, not a ПЭТ exception.
    const door = values(product, "Покрытие двери").filter(meaningful);
    return door.length ? door : values(product, "Покрытие").filter(meaningful);
  }
  if (field === "Терморазрыв") {
    return binary(product, "ВХ. Терморазрыв", "С терморазрывом", "Без терморазрыва");
  }
  if (field === "Остекление") {
    if (product.guid_group === CATALOG_BOT_SECTIONS[0].guid) {
      return binary(product, "ВХ. Стеклопакет", "Со стеклом", "Без стекла");
    }
    // Explicit source classifications only. An absent value is NOT "no glass".
    const found = new Set(values(product, "Вид двери").flatMap(raw => {
      const v = normalizeSearch(raw);
      if (/^глухая(?:\s*\(дг\))?$/.test(v)) return ["Без стекла"];
      if (/^(?:стеклянная(?:\s*\(до\))?|частично остекленная(?:\s*\(дч\))?)$/.test(v)) return ["Со стеклом"];
      return [];
    }));
    return found.size === 1 ? [...found] : [];
  }
  return values(product, field).filter(meaningful);
}
