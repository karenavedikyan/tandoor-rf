import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { GUID } from "../internal-catalog/model";

export const FILES = {
  holdings: { kind: "holding", key: "guid_holding", paths: ["clients/all_holding(full).json", "clients/all_holding.json"] },
  clients: { kind: "legal", key: "guid_client", paths: ["clients/all_clients(full).json", "clients/all_clients.json"] },
  retail: { kind: "retail", key: "guid_store", paths: ["clients/all_tt(full).json", "clients/all_retail.json"] },
  employees: { kind: "employee", key: "guid_manager", paths: ["clients/all_employees.json"] },
  sales: { kind: "legal", key: "", paths: ["sale/all_sale.json", "sale/sale.json"] },
  saleItems: { kind: "legal", key: "", paths: ["sale/all_sale(items).json", "sale/sale(items).json"] },
  returns: { kind: "legal", key: "", paths: ["sale/all_returne.json", "sale/returne.json"] },
  returnItems: { kind: "legal", key: "", paths: ["sale/all_returne(items).json", "sale/returne(items).json"] },
  products: { kind: "product", key: "guid", paths: ["products/products.json", "catalog/products.json", "products.json"] },
  groups: { kind: "group", key: "guid_group", paths: ["products/products_group.json", "catalog/products_group.json", "products_group.json"] },
  prices: { kind: "product", key: "guid", paths: ["products/price.json", "catalog/price.json", "price.json"] },
  stocks: { kind: "product", key: "guid", paths: ["products/stock.json", "catalog/stock.json", "stock.json"] },
} as const;
export type FileKey = keyof typeof FILES;
export type Kind = typeof FILES[FileKey]["kind"];
export type Row = Record<string, unknown>;
export type ManualFiles = Record<FileKey, { bytes: Buffer; sourceName: string }>;
export type RecordRow = { file: FileKey; index: number; kind: Kind; guid: string | null; record: Row; raw: unknown };
export type Issue = {
  key: string; kind: Kind; guid: string | null; file: FileKey; field: string;
  code: string; message: string; indices: number[];
};
export type Prepared = {
  fingerprint: string; files: ManualFiles; records: RecordRow[];
  groups: Record<FileKey, Map<string, RecordRow[]>>; issues: Issue[];
  counts: Record<FileKey, number>;
};
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 160 * 1024 * 1024;
export const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
export function guid(value: unknown): string | null {
  return typeof value === "string" && GUID.test(value.trim()) &&
    value.trim() !== "00000000-0000-0000-0000-000000000000" ? value.trim().toLowerCase() : null;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ":" + canonical((value as Row)[key])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
/** Consensus fields only, never arbitrary first/last conflict resolution. Raw rows are retained. */
export function consensus(rows: RecordRow[]): Row {
  const result: Row = {};
  for (const key of Object.keys(rows[0]?.record ?? {})) {
    const value = rows[0].record[key];
    if (rows.every(row => canonical(row.record[key]) === canonical(value))) result[key] = value;
  }
  return result;
}
export function addIssue(p: Prepared, target: RecordRow, field: string, code: string, message: string,
  indices = [target.index]): void {
  const key = hash(canonical([target.file, target.guid, field, code, indices]));
  if (!p.issues.some(issue => issue.key === key)) p.issues.push({
    key, kind: target.kind, guid: target.guid, file: target.file, field, code, message, indices,
  });
}
export function prepareManualBundle(files: ManualFiles): Prepared {
  const p: Prepared = { fingerprint: "", files, records: [], groups: {} as Prepared["groups"], issues: [],
    counts: {} as Prepared["counts"] };
  let total = 0;
  const fingerprints: unknown[] = [];
  for (const file of Object.keys(FILES) as FileKey[]) {
    const source = files[file];
    if (!source || source.bytes.length > MAX_FILE_BYTES || (total += source.bytes.length) > MAX_BUNDLE_BYTES)
      throw new Error("FILE_TOO_LARGE");
    if (!isUtf8(source.bytes)) throw new Error("INVALID_UTF8");
    let input: unknown;
    try { input = JSON.parse(source.bytes.toString("utf8").replace(/^\uFEFF/, "")); }
    catch { throw new Error("INVALID_JSON"); }
    if (!Array.isArray(input) || input.length > 200_000) throw new Error("INVALID_ROOT");
    p.counts[file] = input.length;
    p.groups[file] = new Map();
    fingerprints.push([file, source.sourceName, hash(source.bytes)]);
    input.forEach((raw, index) => {
      // Non-object array members are source-quality errors too; retain exact value in files.
      const record = object(raw), meta = FILES[file];
      const id = guid(meta.key ? record[meta.key] : object(record.client_info).guid ?? object(record.client_info).id);
      const row: RecordRow = { file, index, kind: meta.kind, guid: id, record, raw };
      p.records.push(row);
      if (!id) addIssue(p, row, meta.key || "client_info.guid", "INVALID_GUID", "Не указан корректный GUID. Требует проверки в 1С.");
      else {
        const list = p.groups[file].get(id) ?? [];
        list.push(row); p.groups[file].set(id, list);
      }
    });
  }
  p.fingerprint = hash(canonical(fingerprints));
  for (const file of ["holdings", "clients", "retail", "employees", "products", "groups", "prices", "stocks"] as FileKey[]) {
    for (const rows of p.groups[file].values()) {
      if (rows.length > 1) addIssue(p, rows[0], FILES[file].key, "DUPLICATE_GUID",
        new Set(rows.map(row => canonical(row.record))).size > 1
          ? "Повтор GUID: исходные значения различаются." : "Повтор GUID: одинаковые исходные записи.",
        rows.map(row => row.index));
    }
  }
  const has = (file: FileKey, value: unknown) => !!guid(value) && p.groups[file].has(guid(value)!);
  for (const row of p.records) {
    const r = row.record;
    if (row.file === "clients" || row.file === "retail") {
      if (guid(r.guid_holding) && !has("holdings", r.guid_holding))
        addIssue(p, row, "guid_holding", "MISSING_HOLDING", "Холдинг отсутствует в справочнике выгрузки.");
    }
    if (row.file === "holdings") {
      for (const [field, file] of [["legal_entities", "clients"], ["retail_outlets", "retail"]] as const) {
        for (const member of Array.isArray(r[field]) ? r[field] as unknown[] : []) {
          const id = guid(object(member).guid_retail);
          if (!id || !has(file, id)) addIssue(p, row, field, "MISSING_MEMBER", "Участник состава отсутствует в справочнике выгрузки.");
          else for (const child of p.groups[file].get(id)!) {
            if (guid(child.record.guid_holding) !== row.guid) {
              addIssue(p, row, field, "MEMBERSHIP_CONFLICT", "Состав холдинга и связь в карточке участника не совпадают.");
              addIssue(p, child, "guid_holding", "MEMBERSHIP_CONFLICT", "Связь с холдингом и состав холдингов не совпадают.");
            }
          }
        }
      }
    }
    if (["sales", "saleItems", "returns", "returnItems"].includes(row.file)) {
      if (!row.guid || !has("clients", row.guid))
        addIssue(p, row, "client_info.guid", "MISSING_CLIENT", "Юрлицо отсутствует в справочнике выгрузки.");
      const info = object(r.sale_info ?? r.returne_info);
      if ("guid_item" in info && !has("products", info.guid_item))
        addIssue(p, row, "guid_item", "MISSING_PRODUCT", "Товар отсутствует в справочнике выгрузки.");
    }
    if (row.file === "products" && guid(r.guid_group) && !has("groups", r.guid_group))
      addIssue(p, row, "guid_group", "MISSING_GROUP", "Группа товара отсутствует в справочнике выгрузки.");
    if (row.file === "products" && guid(r.guid_group) && (p.groups.groups.get(guid(r.guid_group)!)?.length ?? 0) > 1)
      addIssue(p, row, "guid_group", "DUPLICATE_GROUP", "В справочнике повторяется группа этого товара. Требует проверки.");
    if (row.file === "groups" && guid(r.owner_group) && !has("groups", r.owner_group))
      addIssue(p, row, "owner_group", "MISSING_GROUP", "Родительская группа отсутствует в справочнике выгрузки.");
    if ((row.file === "prices" || row.file === "stocks") && !has("products", row.guid))
      addIssue(p, row, "guid", "MISSING_PRODUCT", "Товар отсутствует в справочнике выгрузки.");
  }
  // An identity mismatch is a warning, never a reason to rebind by INN.
  for (const file of ["sales", "saleItems", "returns", "returnItems"] as const) {
    for (const rows of p.groups[file].values()) {
      const inns = new Set(rows.map(row => String(object(row.record.client_info).inn ?? "").trim()).filter(Boolean));
      if (inns.size > 1) addIssue(p, rows[0], "client_info.inn", "INN_CONFLICT",
        "У одного GUID переданы разные ИНН.", rows.map(row => row.index));
      const client = consensus(p.groups.clients.get(rows[0].guid!) ?? []);
      if (client.inn && [...inns].some(inn => inn !== String(client.inn).trim()))
        addIssue(p, rows[0], "client_info.inn", "INN_MISMATCH", "ИНН в операциях и справочнике не совпадают.");
    }
  }
  return p;
}
