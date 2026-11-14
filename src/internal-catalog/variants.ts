import { normalizeSearch, propertyValue, type Product } from "./model";
import { commerceFor, type CatalogContext } from "./presentation";

const dimensions = (value: string) => normalizeSearch(value).replace(/(\d)\s*[хx×*]\s*(?=\d)/g, "$1×");
export function productSize(product: Product): string | null {
  const value = propertyValue(product, "Размер, мм");
  return value && /^\d+(?:[.,]\d+)?(?:×\d+(?:[.,]\d+)?){1,2}$/.test(dimensions(value)) ? dimensions(value) : null;
}
/** Owner-approved presentation identity: name without dimensions, not source relationships.
 * Keep model numbers, finish, handing and all other words. Never rewrite the source name. */
export function productModelName(product: Product): string {
  const original = product.name.normalize("NFKC");
  const name = original
    .replace(/(?<!\d)\d+(?:[.,]\d+)?(?:\s*[хХxX×*]\s*\d+(?:[.,]\d+)?){1,2}(?!\d)/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+/g, " ").trim();
  return name || original.trim();
}
export function sizeModelKey(product: Product): string | null {
  return normalizeSearch(productModelName(product)) || null;
}
function identity(product: Product, context: CatalogContext, priceType: string) {
  const model = sizeModelKey(product), price = commerceFor(context, product.guid).prices.find(x => x.guid === priceType);
  return !model || !price || price.conflict || price.value === null || !Number.isFinite(price.value) || price.value < 0 ? null :
    JSON.stringify([model, priceType, price.value]);
}
// The following classification helpers are audit diagnostics only, not grouping gates.
// These are SKU-specific commercial/service values, not physical configuration.
// Never copy them between sizes: detail/reply still use the selected original SKU.
const presentationFields = new Set(["Размер, мм", "Артикул", "Главная", "главная (бот)", "Название для сайта",
  "Актуальный остаток", "Дата ожидаемого поступления", "Количество ожидаемого поступления",
  "Гарантийный срок", "Условия эксплуатации", "Новинка", "Хит продаж", "Акция",
  "Тип товара", "сайт Тандор", "СсылкаНаГлавнуюNEW"]);
// The legacy checkbox varies between sizes of the same source-linked model
// (e.g. Avallon melange left). Keep it on the selected SKU, not in family identity.
// Exact glass specifications ("Стекло", "Стеклопакет") still distinguish finishes.
const sizeVariantFields = new Set(["ВХ. Стеклопакет"]);
const derivedClassifications = new Map([
  ["Цветовая гамма", "Цвет"],
  ["МТ. Толщина полотна (сайт)", "Толщина полотна, мм"],
  ["МТ. Толщина стали (сайт)", "Толщина стали, мм"],
]);
// Comparison only: do not rewrite the original properties or infer synonyms.
const configurationValue = (value: string) => value.normalize("NFC").toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
function nonBlockingClassifications(products: Product[]): Set<string> {
  const fields = new Set<string>();
  for (const [classification, exactField] of derivedClassifications) {
    const exactValues = products.map(product => new Set(product.properties
      .filter(p => p.name.trim() === exactField).map(p => configurationValue(p.value)).filter(Boolean)));
    // An absent or ambiguous exact value must not hide a classification conflict.
    if (exactValues.every(values => values.size === 1) &&
        new Set(exactValues.map(values => [...values][0])).size === 1) fields.add(classification);
  }
  return fields;
}
function configuration(product: Product, nonBlocking: Set<string>): Map<string, string> {
  const values = new Map<string, Set<string>>();
  for (const property of product.properties) {
    const name = property.name.trim(), value = configurationValue(property.value);
    if (!value || presentationFields.has(name) || sizeVariantFields.has(name) || nonBlocking.has(name) ||
        /^АкцияДействует(?:С|До)_/.test(name)) continue;
    const entries = values.get(name) ?? new Set<string>();
    entries.add(JSON.stringify([property.guid, value])); values.set(name, entries);
  }
  return new Map([...values].map(([name, entries]) => [name, JSON.stringify([...entries].sort())]));
}
function configurationAnalysis(products: Product[]) {
  const nonBlocking = nonBlockingClassifications(products);
  const configurations = products.map(product => configuration(product, nonBlocking)), observed = new Map<string, Set<string>>();
  for (const fields of configurations) for (const [name, value] of fields) {
    const values = observed.get(name) ?? new Set<string>();
    values.add(value); observed.set(name, values);
  }
  const conflicts = [...observed].filter(([, values]) => values.size > 1).map(([name]) => name).sort();
  return { configurations, conflicts };
}
export function conflictingConfigurationFields(products: Product[]): string[] {
  // Diagnostic information only. Attribute differences no longer split cards.
  return configurationAnalysis(products).conflicts;
}
export type ProductFamily = { products: Product[]; modelName: string | null };
/** Presentation only. Every original GUID, property, photo and stock stays separate. */
export function productFamilies(products: Product[], context: CatalogContext, priceType: string): ProductFamily[] {
  const buckets = new Map<string, Product[]>();
  for (const product of products) {
    const key = identity(product, context, priceType) ?? product.guid;
    const bucket = buckets.get(key) ?? []; bucket.push(product); buckets.set(key, bucket);
  }
  return [...buckets.values()].map<ProductFamily>(items => {
    if (items.length < 2) return { products: items, modelName: null };
    // Keep same-size and size-less source records selectable, with distinct GUIDs.
    items.sort((a, b) => (productSize(a) ?? "").localeCompare(productSize(b) ?? "", "ru", { numeric: true }) ||
      a.guid.localeCompare(b.guid));
    return { products: items, modelName: productModelName(items[0]) };
  });
}
