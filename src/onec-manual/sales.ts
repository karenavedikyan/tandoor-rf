import type { PoolClient } from "pg";
import { parseLegalSalesJsonBytes } from "../onec-sales/parse-sale-json";
import { parseLegalSaleItemsJsonBytes } from "../onec-sales/parse-sale-items-json";
import { parseLegalReturnsJsonBytes } from "../onec-sales/parse-returne-json";
import { parseLegalReturnItemsJsonBytes } from "../onec-sales/parse-returne-items-json";
import { analyzeSalesBundle, isBundleParityOk } from "../onec-sales/bundle-analyze";
import { activateSalesMonthSnapshots, type SalesMonthDataset } from "../onec-sales/month-activation";
import type { ParsedLegalSaleLine, ParsedLegalSaleItemLine, ParsedLegalReturnLine, ParsedLegalReturnItemLine } from "../onec-sales/types";
import { addIssue, canonical, hash, type FileKey, type Prepared } from "./model";

type Line = ParsedLegalSaleLine | ParsedLegalSaleItemLine | ParsedLegalReturnLine | ParsedLegalReturnItemLine;
type Parser<T> = (bytes: Buffer) => { ok: true; roster: { lines: T[] } } | { ok: false };
function parse<T extends Line>(p: Prepared, file: FileKey, parser: Parser<T>): T[] {
  const rows = p.records.filter(row => row.file === file), parsed = parser(p.files[file].bytes);
  if (parsed.ok) return parsed.roster.lines;
  const lines: T[] = [];
  for (const row of rows) {
    const one = parser(Buffer.from(JSON.stringify([row.record])));
    if (one.ok) lines.push(...one.roster.lines.map(line => ({ ...line, sourceRowIndex: row.index })));
    else addIssue(p, row, "metrics", "INVALID_METRICS", "Строка сохранена, но показатели нельзя безопасно использовать в расчётах.");
  }
  return lines;
}
export function prepareSales(p: Prepared) {
  // Parse aggregate rows individually: the legacy whole-file parser silently folds exact repeats.
  let sales = p.records.filter(row => row.file === "sales").flatMap(row => {
    const parsed = parseLegalSalesJsonBytes(Buffer.from(JSON.stringify([row.record])));
    if (!parsed.ok) { addIssue(p, row, "metrics", "INVALID_METRICS",
      "Строка сохранена, но показатели нельзя безопасно использовать в расчётах."); return []; }
    return parsed.roster.lines.map(line => ({ ...line, sourceRowIndex: row.index }));
  });
  const saleItems = parse(p, "saleItems", parseLegalSaleItemsJsonBytes);
  const returns = parse(p, "returns", parseLegalReturnsJsonBytes);
  const returnItems = parse(p, "returnItems", parseLegalReturnItemsJsonBytes);
  const byKey = new Map<string, ParsedLegalSaleLine[]>(), unsafe = new Set<string>();
  const key = (l: ParsedLegalSaleLine) => canonical([l.legalGuid, l.saleMonthYyyyMm, l.productType]);
  for (const line of sales) {
    const group = byKey.get(key(line)) ?? []; group.push(line); byKey.set(key(line), group);
  }
  for (const [k, lines] of byKey) if (lines.length > 1) {
    const row = p.records.find(row => row.file === "sales" && row.index === lines[0].sourceRowIndex)!;
    addIssue(p, row, "sale_info", "DUPLICATE_SALES_KEY", "Повтор ключа сводных продаж. Исходные строки сохранены.",
      lines.map(l => l.sourceRowIndex));
    if (new Set(lines.map(({ sourceRowIndex: _, ...rest }) => canonical(rest))).size > 1) unsafe.add(k);
  }
  // Conflicting totals are not overwritten by first/last. Exact duplicate aggregate lines count once.
  sales = [...byKey].filter(([k]) => !unsafe.has(k)).map(([, lines]) => lines[0]);
  const roster = <T>(file: FileKey, lines: T[]) => ({ sourceSha256: hash(p.files[file].bytes), lines, lineCount: lines.length });
  const result = { sales: roster("sales", sales), saleItems: roster("saleItems", saleItems),
    returns: roster("returns", returns), returnItems: roster("returnItems", returnItems) };
  const ids = new Set([...sales, ...saleItems, ...returns, ...returnItems].map(l => l.legalGuid));
  for (const id of ids) {
    const report = analyzeSalesBundle({
      salesAggregate: roster("sales", sales.filter(l => l.legalGuid === id)),
      salesItems: roster("saleItems", saleItems.filter(l => l.legalGuid === id)),
      returnsAggregate: roster("returns", returns.filter(l => l.legalGuid === id)),
      returnsItems: roster("returnItems", returnItems.filter(l => l.legalGuid === id)),
      knownCatalogLegalGuids: new Set(p.groups.clients.keys()),
    });
    if (!isBundleParityOk(report)) {
      const row = p.records.find(row => row.guid === id && ["sales", "saleItems", "returns", "returnItems"].includes(row.file))!;
      addIssue(p, row, "metrics", "SALES_PARITY", "Сводные показатели и товарная детализация не совпадают. Требует проверки в 1С.");
    }
  }
  return result;
}

export async function projectSales(db: PoolClient, p: Prepared, sales: ReturnType<typeof prepareSales>) {
  const known = new Set((await db.query<{ guid_client: string }>("SELECT guid_client::text FROM onec_v3_legal_entities")).rows.map(x => x.guid_client));
  for (const [file, dataset, table, stateTable, roster, items, finance] of [
    ["sales", "sale_aggregate", "onec_v3_legal_sales_lines", "onec_v3_legal_sales_import_state", sales.sales, false, true],
    ["saleItems", "sale_items", "onec_v3_legal_sale_item_lines", "onec_v3_legal_sale_item_import_state", sales.saleItems, true, true],
    ["returns", "return_aggregate", "onec_v3_legal_return_lines", "onec_v3_legal_return_import_state", sales.returns, false, false],
    ["returnItems", "return_items", "onec_v3_legal_return_item_lines", "onec_v3_legal_return_item_import_state", sales.returnItems, true, false],
  ] as const) {
    const aggregate = file === "sales";
    const mapping: Array<[string, string, string]> = [
      ["legal_guid", "legalGuid", "uuid"], ["sale_month", "saleMonthStartIso", "date"], ["product_type", "productType", "text"],
      ["quantity", "quantity", "numeric"], ["income", "income", "numeric"],
    ];
    if (!aggregate) mapping.push(["source_row_index", "sourceRowIndex", "integer"], ["catalog_matched", "catalogMatched", "boolean"]);
    if (items) mapping.push(["guid_item", "guidItem", "uuid"], ["name_item", "nameItem", "text"]);
    if (finance) for (const [column, field] of [
      ["manual_discount", "manualDiscount"], ["automatic_discount", "automaticDiscount"], ["total_discount", "totalDiscount"],
      ["cost_price", "costPrice"], ["additional_expenses", "additionalExpenses"], ["gross_profit", "grossProfit"], ["profitability", "profitability"],
    ]) mapping.push([column, field, "numeric"]);
    let projected: Array<Record<string, unknown>> = roster.lines.map(line => ({ ...line, catalogMatched: known.has(line.legalGuid) }));
    if (!aggregate) {
      const existing = await db.query(`SELECT l.* FROM ${table} l
        JOIN onec_v3_legal_sales_month_activation a ON a.dataset=$1 AND a.sale_month=l.sale_month AND a.source_sha256=l.source_sha256`,
      [dataset]);
      const businessKey = (line: Record<string, unknown>) => canonical([
        line.legalGuid, line.saleMonthStartIso, line.productType, line.guidItem ?? null,
      ]);
      const supplied = new Set(projected.map(businessKey));
      let retainedIndex = p.counts[file];
      const retained = existing.rows.map(row => {
        const line: Record<string, unknown> = {};
        for (const [column, field] of mapping) line[field] = column === "sale_month"
          ? (row[column] instanceof Date ? row[column].toISOString().slice(0, 10) : String(row[column]).slice(0, 10)) : row[column];
        return line;
      }).filter(line => !supplied.has(businessKey(line))).map(line => ({ ...line, sourceRowIndex: retainedIndex++ }));
      projected = projected.concat(retained);
    }
    const projectionSha = aggregate ? roster.sourceSha256 : hash(canonical(projected));
    for (let start = 0; start < projected.length; start += 500) {
      const lines = projected.slice(start, start + 500);
      const columns = mapping.map(([column]) => column);
      const fields = mapping.map(([, field]) => `x."${field}"`);
      const definitions = mapping.map(([, field, type]) => `"${field}" ${type}`);
      const conflict = aggregate
        ? `ON CONFLICT(legal_guid,sale_month,product_type) DO UPDATE SET ${columns.slice(3).map(c => `${c}=EXCLUDED.${c}`).join(",")},
          source_sha256=EXCLUDED.source_sha256,imported_at=NOW()`
        : "ON CONFLICT DO NOTHING";
      await db.query(`INSERT INTO ${table}(${columns.join(",")},source_sha256)
        SELECT ${fields.join(",")},$1 FROM jsonb_to_recordset($2::jsonb) AS x(${definitions.join(",")}) ${conflict}`,
      [projectionSha, JSON.stringify(lines)]);
    }
    const months = [...new Set(projected.map(line => String(line.saleMonthStartIso)))];
    await activateSalesMonthSnapshots(db, dataset as SalesMonthDataset, projectionSha, months);
    await db.query(`INSERT INTO ${stateTable}(id,source_sha256,row_count) VALUES(1,$1,$2)
      ON CONFLICT(id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,row_count=EXCLUDED.row_count,imported_at=NOW()`,
    [projectionSha, projected.length]);
  }
}
