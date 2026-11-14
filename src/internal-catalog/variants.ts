import { normalizeSearch, propertyValue, type Product } from "./model";
import { commerceFor, type CatalogContext } from "./presentation";

const dimensions = (value: string) => normalizeSearch(value).replace(/(\d)\s*[хx×*]\s*(?=\d)/g, "$1×");
export function productSize(product: Product): string | null {
  const value = propertyValue(product, "Размер, мм");
  return value && /^\d+(?:[.,]\d+)?(?:×\d+(?:[.,]\d+)?){1,2}$/.test(dimensions(value)) ? dimensions(value) : null;
}
export function sizeModelKey(product: Product): string | null {
  const size = productSize(product), link = propertyValue(product, "СсылкаНаГлавную");
  if (!size || !link) return null;
  // The source relationship is necessary, but not sufficient: some source links
  // include samples, other models or finishes. Never infer a relationship from names.
  const name = dimensions(product.name), at = name.indexOf(size);
  if (at < 0 || (at > 0 && /\d/.test(name[at - 1])) || /\d/.test(name[at + size.length] ?? "")) return null;
  const modelName = name.slice(0, at) + "{size}" + name.slice(at + size.length);
  return JSON.stringify([link, modelName, product.guid_group ?? "", product.chapter.map(x => x.guid).sort()]);
}
function identity(product: Product, context: CatalogContext, priceType: string) {
  const model = sizeModelKey(product), price = commerceFor(context, product.guid).prices.find(x => x.guid === priceType);
  return !model || !price || price.conflict || price.value === null ? null :
    JSON.stringify([model, priceType, price.value, price.name]);
}
// These are SKU-specific commercial/service values, not physical configuration.
// Never copy them between sizes: detail/reply still use the selected original SKU.
const presentationFields = new Set(["Размер, мм", "Артикул", "Главная", "главная (бот)", "Название для сайта",
  "Актуальный остаток", "Дата ожидаемого поступления", "Количество ожидаемого поступления",
  "Гарантийный срок", "Условия эксплуатации", "Новинка", "Хит продаж", "Акция"]);
function configuration(product: Product): Map<string, string> {
  const values = new Map<string, Set<string>>();
  for (const property of product.properties) {
    const name = property.name.trim(), value = property.value.trim();
    if (!value || presentationFields.has(name) || /^АкцияДействует(?:С|До)_/.test(name)) continue;
    const entries = values.get(name) ?? new Set<string>();
    entries.add(JSON.stringify([property.guid, value])); values.set(name, entries);
  }
  return new Map([...values].map(([name, entries]) => [name, JSON.stringify([...entries].sort())]));
}
function configurationAnalysis(products: Product[]) {
  const configurations = products.map(configuration), observed = new Map<string, Set<string>>();
  for (const fields of configurations) for (const [name, value] of fields) {
    const values = observed.get(name) ?? new Set<string>();
    values.add(value); observed.set(name, values);
  }
  const conflicts = [...observed].filter(([, values]) => values.size > 1).map(([name]) => name).sort();
  return { configurations, conflicts };
}
export function conflictingConfigurationFields(products: Product[]): string[] {
  return configurationAnalysis(products).conflicts;
}
function compatibleConfigurations(products: Product[]): Product[][] {
  const { configurations, conflicts } = configurationAnalysis(products);
  const groups = new Map<string, Product[]>();
  products.forEach((product, index) => {
    const fields = configurations[index];
    // Missing is unknown, never a fabricated value. When known values disagree,
    // an unknown SKU must not bridge two incompatible configurations.
    const key = conflicts.some(name => !fields.has(name)) ? product.guid :
      JSON.stringify(conflicts.map(name => fields.get(name)));
    const group = groups.get(key) ?? []; group.push(product); groups.set(key, group);
  });
  return [...groups.values()];
}
export type ProductFamily = { products: Product[]; modelName: string | null };
/** Presentation only. Every original GUID, property, photo and stock stays separate. */
export function productFamilies(products: Product[], context: CatalogContext, priceType: string): ProductFamily[] {
  const buckets = new Map<string, Product[]>();
  for (const product of products) {
    const key = identity(product, context, priceType) ?? product.guid;
    const bucket = buckets.get(key) ?? []; bucket.push(product); buckets.set(key, bucket);
  }
  return [...buckets.values()].flatMap(compatibleConfigurations).flatMap<ProductFamily>(items => {
    // Two source products for the same size are ambiguous; hide neither.
    if (items.length < 2 || new Set(items.map(productSize)).size !== items.length) {
      return items.map(product => ({ products: [product], modelName: null }));
    }
    items.sort((a, b) => productSize(a)!.localeCompare(productSize(b)!, "ru", { numeric: true }) || a.guid.localeCompare(b.guid));
    const first = items[0], size = productSize(first)!;
    // Preserve original case/spelling in the visible model title.
    const original = first.name.normalize("NFKC").replace(/(\d)\s*[хx×*]\s*(?=\d)/g, "$1×").replace(/\s+/g, " ").trim();
    const at = normalizeSearch(original).indexOf(size);
    const modelName = at < 0 ? first.name : (original.slice(0, at) + original.slice(at + size.length)).replace(/\s+/g, " ").trim();
    return [{ products: items, modelName }];
  });
}
