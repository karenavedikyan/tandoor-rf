import { normalizeSearch, type Product } from "../internal-catalog/model";
import { productModelName } from "../internal-catalog/variants";

/** Bot-only visual identity. Originals, LK families, prices and GUIDs stay intact. */
export function catalogModelName(product: Product): string {
  let name = productModelName(product);
  const door = /^(?:Входные|Межкомнатные) двери$/.test(product.name_group ?? "");
  if (door) name = name.replace(/(^|[\s,(])(?:левая|правая|левое|правое|левый|правый|лев|прав|L|R)(?=$|[\s,).])/gi, "$1");
  return name.replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+/g, " ").trim() || productModelName(product);
}

export type CatalogModel = {
  name: string; products: Product[];
  photos: { product: Product; file: Product["files"][number] }[];
};
const collator = new Intl.Collator("ru", { numeric: true });
export function catalogModels(products: Product[]): CatalogModel[] {
  const models = new Map<string, CatalogModel>();
  for (const product of products) {
    const name = catalogModelName(product);
    const key = JSON.stringify([product.guid_group, normalizeSearch(name)]);
    const model = models.get(key) ?? { name, products: [], photos: [] };
    model.products.push(product); models.set(key, model);
  }
  for (const model of models.values()) {
    // Stable identity and gallery order, independent of current SQL row order.
    model.products.sort((a, b) => a.guid.localeCompare(b.guid));
    const paths = new Set<string>();
    for (const product of model.products) for (const file of product.files) {
      const path = file.path.replace(/\\/g, "/");
      if (!paths.has(path)) {
        paths.add(path); model.photos.push({ product, file });
      }
    }
  }
  return [...models.values()].sort((a, b) => collator.compare(a.name, b.name) ||
    a.products[0].guid.localeCompare(b.products[0].guid));
}
