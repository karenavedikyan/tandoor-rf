import type { ParsedCatalogProduct } from "./types";

export function computeCatalogContentCounts(products: ParsedCatalogProduct[]): {
  propertyCount: number;
  imagePathCount: number;
} {
  let propertyCount = 0;
  let imagePathCount = 0;
  for (const product of products) {
    propertyCount += product.properties.length;
    imagePathCount += product.images.length;
  }
  return { propertyCount, imagePathCount };
}
