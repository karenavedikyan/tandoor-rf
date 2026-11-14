import { normalizeSearch, propertyValue, type Product } from "./model";
import { commerceFor, type CatalogContext } from "./presentation";

const dimensions = (value: string) => normalizeSearch(value).replace(/(\d)\s*[хx×*]\s*(?=\d)/g, "$1×");
export function productSize(product: Product): string | null {
  const value = propertyValue(product, "Размер, мм");
  return value && /^\d+(?:[.,]\d+)?(?:×\d+(?:[.,]\d+)?){1,2}$/.test(dimensions(value)) ? dimensions(value) : null;
}
function identity(product: Product, context: CatalogContext, priceType: string) {
  const size = productSize(product), link = propertyValue(product, "СсылкаНаГлавную");
  const price = commerceFor(context, product.guid).prices.find(x => x.guid === priceType);
  if (!size || !link || !price || price.conflict || price.value === null) return null;
  // The source relationship is necessary, but not sufficient: some source links
  // include samples, other models or finishes. Never infer a relationship from names.
  const name = dimensions(product.name), at = name.indexOf(size);
  if (at < 0 || (at > 0 && /\d/.test(name[at - 1])) || /\d/.test(name[at + size.length] ?? "")) return null;
  const modelName = name.slice(0, at) + "{size}" + name.slice(at + size.length);
  const properties = product.properties.filter(x => !["Размер, мм", "Артикул", "Главная", "главная (бот)"].includes(x.name.trim()))
    .map(x => [x.guid, x.name.trim(), x.value.trim()]).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([link, modelName, product.guid_group ?? "", product.chapter.map(x => x.guid).sort(),
    properties, priceType, price.value, price.name]);
}
export type ProductFamily = { products: Product[]; modelName: string | null };
/** Presentation only. Every original GUID, property, photo and stock stays separate. */
export function productFamilies(products: Product[], context: CatalogContext, priceType: string): ProductFamily[] {
  const buckets = new Map<string, Product[]>();
  for (const product of products) {
    const key = identity(product, context, priceType) ?? product.guid;
    const bucket = buckets.get(key) ?? []; bucket.push(product); buckets.set(key, bucket);
  }
  return [...buckets.values()].flatMap<ProductFamily>(items => {
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
