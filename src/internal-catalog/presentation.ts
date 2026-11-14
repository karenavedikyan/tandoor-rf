import { GUID, normalizeSearch, propertyValue, type Product } from "./model";

/** Explicit source names only. No classification or compatibility inferred from names. */
export const CATALOG_FACETS = [
  "Цвет", "Цветовая гамма", "Покрытие", "Покрытие двери", "Материал", "Дизайн", "Вид двери",
  "Размер, мм", "Высота", "Длина", "Толщина", "Сторона открывания", "Тип товара", "Тип погонажа",
  "Тип фурнитуры", "Толщина полотна, мм", "Толщина стали, мм", "ВХ. Терморазрыв", "ВХ. По назначению",
  "ФР. Вид ручки", "ФР. Основание ручки", "ФР. Тип установки", "ФР. Тип замка", "ФР.Стиль",
] as const;
type Raw = Record<string, unknown>;
export type SourceRow = { file_key: string; record: Raw; imported_at: Date | string };
export type Amount = { guid: string; name: string; value: number | null; conflict: boolean };
export type Commerce = { prices: Amount[]; warehouses: Amount[]; quantity: number | null;
  pricesImportedAt: string | null; stocksImportedAt: string | null };
export type Group = { guid: string; name: string; parent: string | null; conflict: boolean };
export type CatalogContext = { commerce: Map<string, Commerce>; groups: Group[]; priceTypes: { guid: string; name: string }[] };
const object = (x: unknown): Raw => x && typeof x === "object" && !Array.isArray(x) ? x as Raw : {};
const id = (x: unknown) => typeof x === "string" && GUID.test(x) ? x.toLowerCase() : null;
const text = (x: unknown) => typeof x === "string" ? x.trim() : "";
const timestamp = (x: Date | string) => new Date(x).toISOString();
const empty = (): Commerce => ({ prices: [], warehouses: [], quantity: null, pricesImportedAt: null, stocksImportedAt: null });

/** Duplicate identical values collapse. Conflicting/malformed values remain unknown, never summed. */
export function buildCatalogContext(rows: SourceRow[]): CatalogContext {
  const commerce = new Map<string, Commerce>(), groupRows = new Map<string, Raw[]>();
  const amountRows = new Map<string, Map<string, { names: Set<string>; values: Set<number | null> }>>();
  for (const row of rows) {
    if (row.file_key === "groups") {
      const guid = id(row.record.guid_group);
      if (guid) groupRows.set(guid, [...(groupRows.get(guid) ?? []), row.record]);
      continue;
    }
    const guid = id(row.record.guid);
    if (!guid || !["prices", "stocks"].includes(row.file_key)) continue;
    const entry = commerce.get(guid) ?? empty(); commerce.set(guid, entry);
    const price = row.file_key === "prices", key = guid + ":" + row.file_key;
    entry[price ? "pricesImportedAt" : "stocksImportedAt"] = timestamp(row.imported_at);
    const groups = amountRows.get(key) ?? new Map(); amountRows.set(key, groups);
    const input = row.record[price ? "type_price" : "warehouse"];
    // A malformed source row must not turn into a valid zero or a partial total.
    if (!Array.isArray(input) || !input.length) {
      groups.set("invalid", { names: new Set(["Некорректная строка 1С"]), values: new Set([null]) }); continue;
    }
    for (const raw of input) {
      const item = object(raw), itemId = id(item.guid) ?? "invalid", name = text(item.name);
      const value = item[price ? "price" : "quantity"];
      const valid = itemId !== "invalid" && !!name && typeof value === "number" && Number.isFinite(value) && value >= 0;
      const group = groups.get(itemId) ?? { names: new Set<string>(), values: new Set<number | null>() };
      group.names.add(name); group.values.add(valid ? value as number : null); groups.set(itemId, group);
    }
  }
  for (const [key, groups] of amountRows) {
    const [guid, kind] = key.split(":"), entry = commerce.get(guid)!;
    const amounts = [...groups].map(([guid, group]): Amount => {
      const conflict = group.names.size !== 1 || group.values.size !== 1 || group.values.has(null);
      return { guid, name: [...group.names].sort().join(" / ") || "Не указано", conflict,
        value: conflict ? null : [...group.values][0] as number };
    }).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (kind === "prices") entry.prices = amounts;
    else {
      entry.warehouses = amounts;
      entry.quantity = amounts.every(x => !x.conflict) ? amounts.reduce((sum, x) => sum + x.value!, 0) : null;
      if (entry.quantity !== null && !Number.isFinite(entry.quantity)) entry.quantity = null;
    }
  }
  const groups = [...groupRows].map(([guid, records]): Group => {
    const names = new Set(records.map(x => text(x.name_group)));
    const parents = new Set(records.map(x => id(x.owner_group)));
    const conflict = names.size !== 1 || ![...names][0] || parents.size !== 1;
    return { guid, name: [...names].sort().join(" / ") || guid,
      parent: conflict ? null : [...parents][0], conflict: !!conflict };
  });
  // Break missing/self/cyclic parent references, but keep every source group accessible.
  const byId = new Map(groups.map(x => [x.guid, x]));
  for (const group of groups) {
    let cursor: Group | undefined = group; const seen = new Set<string>();
    while (cursor?.parent) {
      if (seen.has(cursor.guid) || !byId.has(cursor.parent)) { group.parent = null; group.conflict = true; break; }
      seen.add(cursor.guid); cursor = byId.get(cursor.parent);
    }
  }
  const types = new Map<string, Set<string>>();
  for (const item of commerce.values()) for (const price of item.prices) {
    if (price.guid === "invalid") continue;
    const names = types.get(price.guid) ?? new Set<string>(); names.add(price.name); types.set(price.guid, names);
  }
  return { commerce, groups: groups.sort((a, b) => a.name.localeCompare(b.name, "ru")),
    priceTypes: [...types].map(([guid, names]) => ({ guid, name: [...names].sort().join(" / ") }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")) };
}
export function groupDescendants(groups: Group[], root: string): string[] {
  const result = new Set([root]); let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) if (group.parent && result.has(group.parent) && !result.has(group.guid)) {
      result.add(group.guid); changed = true;
    }
  }
  return [...result];
}
export function productFlags(product: Product) {
  const yes = (name: string) => ["да", "истина", "true", "1"].includes(normalizeSearch(propertyValue(product, name) ?? ""));
  return { new: yes("Новинка"), hit: yes("Хит продаж"), sale: yes("Акция") };
}
export function productPresentation(product: Product) {
  return { flags: productFlags(product), groupGuid: product.guid_group ?? null,
    properties: product.properties.filter(x => CATALOG_FACETS.includes(x.name.trim() as typeof CATALOG_FACETS[number])),
    files: product.files.map(x => ({ guid: x.guid, name: x.name })) };
}
export function commerceFor(context: CatalogContext, guid: string): Commerce {
  return context.commerce.get(guid) ?? empty();
}
