import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_JSON_BYTES = 40 * 1024 * 1024;
export type Section = { guid: string; name: string };
export type Property = Section & { value: string };
export type SourceFile = Section & { path: string };
export type Product = {
  guid: string; name: string; chapter: Section[]; properties: Property[]; files: SourceFile[];
};
export type Summary = {
  products: number; sections: Section[]; brands: string[]; propertyValues: number;
  imagePaths: number; productsWithImagePaths: number; textsAt1024: number; emptyValues: number;
};
export type ParsedSnapshot = { sha256: string; products: Product[]; summary: Summary };

export function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}
export function propertyValue(product: Product, name: string): string | null {
  return product.properties.find(item => item.name.trim() === name)?.value.trim() || null;
}
export function searchText(product: Product): string {
  return normalizeSearch([product.guid, product.name, ...product.chapter.map(x => x.name),
    ...product.properties.flatMap(x => [x.name, x.value])].join(" "));
}
export function safeImagePath(value: string): string | null {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) ||
      /^[\\/]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const parts = value.replace(/\\/g, "/").split("/");
  if (parts.some(x => !x || x === "." || x === "..") || !/\.(?:jpg|jpeg|png)$/i.test(value)) return null;
  return parts.join("/");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OBJECT");
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error("UNEXPECTED_FIELD");
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) ||
      value.includes("\0")) throw new Error("INVALID_TEXT");
  return value;
}
function identifier(value: unknown): string {
  const result = text(value, 36);
  if (!GUID.test(result)) throw new Error("INVALID_GUID");
  return result.toLowerCase();
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("INVALID_ARRAY");
  return value;
}
function unique<T extends { guid: string }>(items: T[]): T[] {
  if (new Set(items.map(x => x.guid)).size !== items.length) throw new Error("DUPLICATE_GUID");
  return items;
}
export function parseProductsJson(bytes: Buffer): ParsedSnapshot {
  if (bytes.length > MAX_JSON_BYTES) throw new Error("FILE_TOO_LARGE");
  if (!isUtf8(bytes)) throw new Error("INVALID_UTF8");
  let input: unknown;
  try { input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
  catch { throw new Error("INVALID_JSON"); }
  const rows = array(input, 100_000);
  if (!rows.length) throw new Error("EMPTY_SNAPSHOT");
  const sectionNames = new Map<string, string>(), propertyNames = new Map<string, string>();
  function named(raw: unknown, dictionary?: Map<string, string>): Section {
    const row = object(raw), guid = identifier(row.guid), name = text(row.name, 2000);
    if (dictionary?.has(guid) && dictionary.get(guid) !== name) throw new Error("CONFLICTING_NAME");
    dictionary?.set(guid, name);
    return { guid, name };
  }
  const products = unique(rows.map(raw => {
    const row = object(raw);
    keys(row, ["guid", "name", "chapter", "properties", "files"]);
    const chapter = unique(array(row.chapter, 1000).map(x => {
      keys(object(x), ["guid", "name"]);
      return named(x, sectionNames);
    }));
    const properties = unique(array(row.properties, 1000).map(x => {
      keys(object(x), ["guid", "name", "value"]);
      return { ...named(x, propertyNames), value: text(object(x).value, 100_000, true) };
    }));
    const files = unique(array(row.files, 1000).map(x => {
      const file = object(x), path = text(file.path, 2000);
      keys(file, ["guid", "name", "path"]);
      if (!safeImagePath(path)) throw new Error("UNSAFE_IMAGE_PATH");
      return { ...named(x), path };
    }));
    return { guid: identifier(row.guid), name: text(row.name, 5000), chapter, properties, files };
  }));
  const sort = (a: string, b: string) => a.localeCompare(b, "ru");
  const summary: Summary = {
    products: products.length,
    sections: [...sectionNames].map(([guid, name]) => ({ guid, name })).sort((a, b) => sort(a.name, b.name)),
    brands: [...new Set(products.map(x => propertyValue(x, "Бренд")).filter((x): x is string => !!x))].sort(sort),
    propertyValues: 0, imagePaths: 0, productsWithImagePaths: 0, textsAt1024: 0, emptyValues: 0,
  };
  for (const product of products) {
    summary.propertyValues += product.properties.length;
    summary.imagePaths += product.files.length;
    if (product.files.length) summary.productsWithImagePaths++;
    for (const property of product.properties) {
      if (property.value.length === 1024) summary.textsAt1024++;
      if (!property.value.trim()) summary.emptyValues++;
    }
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), products, summary };
}
