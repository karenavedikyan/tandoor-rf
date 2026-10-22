import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope } from "./access-scope";
import { appendAssignmentFilters, type V3ListQuery, type V3ResponsibleKind } from "./list";
import { normalizeSaleMonth } from "../../onec-sales/sale-month";
import { saleMacroGroup, saleMacroGroupLabel, type SaleMacroGroup } from "../../onec-sales/product-type-groups";
import { canViewMarginFields } from "./legal-sales";

export type SalesSectionTerritory = {
  ropBranchGuid?: string;
  responsibleGuid?: string;
  responsibleKind?: V3ResponsibleKind;
  managerGuid?: string;
  teamMemberGuids?: string[];
};

export type SalesSectionImportMeta = {
  aggregateImported: boolean;
  itemsImported: boolean;
  returnsImported: boolean;
  returnItemsImported: boolean;
  aggregateRowCount: number;
  itemsRowCount: number;
  returnsRowCount: number;
  returnItemsRowCount: number;
};

export type SalesSectionCategoryRow = {
  productType: string;
  macroGroup: SaleMacroGroup;
  quantity: string;
  income: string;
  grossProfit?: string | null;
};

export type SalesSectionMacroSummary = {
  group: SaleMacroGroup;
  label: string;
  quantity: string;
  income: string;
  grossProfit?: string | null;
};

export type SalesSectionOverview = {
  month: string;
  currency: "RUB";
  vatNote: string;
  dataState: "not_imported" | "partial" | "loaded";
  salesSource: "items" | "aggregate" | "none";
  returnsSource: "items" | "aggregate" | "none";
  returnsSignedNote: string;
  importMeta: SalesSectionImportMeta;
  macroSummaries: SalesSectionMacroSummary[];
  categories: SalesSectionCategoryRow[];
  returnsMacroSummaries: SalesSectionMacroSummary[];
  returnsCategories: SalesSectionCategoryRow[];
  periodComparisonNote: string;
};

async function loadImportMeta(): Promise<SalesSectionImportMeta> {
  const rows = await query<{
    agg: number | null;
    items: number | null;
    ret: number | null;
    ret_items: number | null;
  }>(
    `
      SELECT
        (SELECT row_count FROM onec_v3_legal_sales_import_state WHERE id = 1) AS agg,
        (SELECT row_count FROM onec_v3_legal_sale_item_import_state WHERE id = 1) AS items,
        (SELECT row_count FROM onec_v3_legal_return_import_state WHERE id = 1) AS ret,
        (SELECT row_count FROM onec_v3_legal_return_item_import_state WHERE id = 1) AS ret_items
    `,
  );
  const row = rows.rows[0] ?? {};
  const aggregateRowCount = Number(row.agg ?? 0);
  const itemsRowCount = Number(row.items ?? 0);
  const returnsRowCount = Number(row.ret ?? 0);
  const returnItemsRowCount = Number(row.ret_items ?? 0);
  return {
    aggregateImported: aggregateRowCount > 0,
    itemsImported: itemsRowCount > 0,
    returnsImported: returnsRowCount > 0,
    returnItemsImported: returnItemsRowCount > 0,
    aggregateRowCount,
    itemsRowCount,
    returnsRowCount,
    returnItemsRowCount,
  };
}

function territoryListInput(territory: SalesSectionTerritory): V3ListQuery {
  return {
    entity: "legal",
    page: 1,
    pageSize: 1,
    q: "",
    ropBranchGuid: territory.ropBranchGuid,
    responsibleGuid: territory.responsibleGuid,
    responsibleKind: territory.responsibleKind,
    managerGuid: territory.managerGuid,
    teamMemberGuids: territory.teamMemberGuids,
  };
}

function buildScopeSql(context: AccessContext, territory: SalesSectionTerritory): {
  clause: string;
  params: unknown[];
} {
  const scope = v3EntityAssignmentScope(context, "le", "legal");
  const params = [...scope.params];
  const filters = appendAssignmentFilters(territoryListInput(territory), "le", params);
  return {
    clause: `(${scope.clause})${filters}`,
    params,
  };
}

type AggRow = {
  product_type: string;
  quantity: string;
  income: string;
  gross_profit: string | null;
};

async function querySalesRollup(
  context: AccessContext,
  territory: SalesSectionTerritory,
  monthIso: string,
  source: "items" | "aggregate",
  includeMargins: boolean,
): Promise<AggRow[]> {
  const { clause, params } = buildScopeSql(context, territory);
  const table =
    source === "items" ? "onec_v3_legal_sale_item_lines" : "onec_v3_legal_sales_lines";
  const matchedFilter = source === "items" ? " AND sl.catalog_matched = TRUE" : "";
  const grossSelect = includeMargins ? "COALESCE(SUM(sl.gross_profit), 0)::text" : "NULL::text";
  const result = await query<AggRow>(
    `
      SELECT
        sl.product_type,
        COALESCE(SUM(sl.quantity), 0)::text AS quantity,
        COALESCE(SUM(sl.income), 0)::text AS income,
        ${grossSelect} AS gross_profit
      FROM ${table} AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE sl.sale_month = $${params.length + 1}::date
        AND (${clause})
        ${matchedFilter}
      GROUP BY sl.product_type
      ORDER BY sl.product_type ASC
    `,
    [...params, monthIso],
  );
  return result.rows;
}

async function queryReturnsRollup(
  context: AccessContext,
  territory: SalesSectionTerritory,
  monthIso: string,
  source: "items" | "aggregate",
): Promise<AggRow[]> {
  const { clause, params } = buildScopeSql(context, territory);
  const table = source === "items" ? "onec_v3_legal_return_item_lines" : "onec_v3_legal_return_lines";
  const matchedFilter = " AND sl.catalog_matched = TRUE";
  const result = await query<AggRow>(
    `
      SELECT
        sl.product_type,
        COALESCE(SUM(sl.quantity), 0)::text AS quantity,
        COALESCE(SUM(sl.income), 0)::text AS income,
        NULL::text AS gross_profit
      FROM ${table} AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE sl.sale_month = $${params.length + 1}::date
        AND (${clause})
        ${matchedFilter}
      GROUP BY sl.product_type
      ORDER BY sl.product_type ASC
    `,
    [...params, monthIso],
  );
  return result.rows;
}

function buildMacroSummaries(rows: AggRow[], includeMargins: boolean): SalesSectionMacroSummary[] {
  const buckets = new Map<SaleMacroGroup, { quantity: number; income: number; gross: number }>();
  for (const row of rows) {
    const macro = saleMacroGroup(row.product_type);
    const bucket = buckets.get(macro) ?? { quantity: 0, income: 0, gross: 0 };
    bucket.quantity += Number(row.quantity);
    bucket.income += Number(row.income);
    if (includeMargins && row.gross_profit != null) {
      bucket.gross += Number(row.gross_profit);
    }
    buckets.set(macro, bucket);
  }
  const order: SaleMacroGroup[] = ["vh", "mk", "furniture", "other"];
  return order
    .filter((g) => buckets.has(g))
    .map((group) => {
      const b = buckets.get(group)!;
      return {
        group,
        label: saleMacroGroupLabel(group),
        quantity: String(b.quantity),
        income: String(b.income),
        grossProfit: includeMargins ? String(b.gross) : null,
      };
    });
}

function mapCategories(rows: AggRow[], includeMargins: boolean): SalesSectionCategoryRow[] {
  return rows.map((row) => ({
    productType: row.product_type,
    macroGroup: saleMacroGroup(row.product_type),
    quantity: row.quantity,
    income: row.income,
    grossProfit: includeMargins ? row.gross_profit : null,
  }));
}

export async function listSalesSectionMonths(): Promise<string[]> {
  const result = await query<{ month: string }>(
    `
      SELECT DISTINCT to_char(sale_month, 'YYYY-MM') AS month
      FROM (
        SELECT sale_month FROM onec_v3_legal_sales_lines
        UNION
        SELECT sale_month FROM onec_v3_legal_sale_item_lines WHERE catalog_matched = TRUE
        UNION
        SELECT sale_month FROM onec_v3_legal_return_lines WHERE catalog_matched = TRUE
        UNION
        SELECT sale_month FROM onec_v3_legal_return_item_lines WHERE catalog_matched = TRUE
      ) AS m
      ORDER BY month DESC
    `,
  );
  return result.rows.map((r) => r.month);
}

export async function loadSalesSectionOverview(
  context: AccessContext,
  monthRaw: string,
  territory: SalesSectionTerritory,
): Promise<SalesSectionOverview | "invalid_month"> {
  const monthParsed = normalizeSaleMonth(monthRaw.length === 7 ? monthRaw : `${monthRaw}-01`);
  if (!monthParsed.ok) {
    return "invalid_month";
  }
  const importMeta = await loadImportMeta();
  const hasAny =
    importMeta.aggregateImported ||
    importMeta.itemsImported ||
    importMeta.returnsImported ||
    importMeta.returnItemsImported;
  const includeMargins = canViewMarginFields(context);

  if (!hasAny) {
    return {
      month: monthParsed.yyyyMm,
      currency: "RUB",
      vatNote: "Суммы с НДС, ₽",
      dataState: "not_imported",
      salesSource: "none",
      returnsSource: "none",
      returnsSignedNote:
        "Возвраты в 1С передаются со знаком минус (quantity и income). Объём возвратов показан как в источнике.",
      importMeta,
      macroSummaries: [],
      categories: [],
      returnsMacroSummaries: [],
      returnsCategories: [],
      periodComparisonNote: "Нет данных для сравнения периодов.",
    };
  }

  const salesSource: "items" | "aggregate" | "none" = importMeta.itemsImported
    ? "items"
    : importMeta.aggregateImported
      ? "aggregate"
      : "none";
  const returnsSource: "items" | "aggregate" | "none" = importMeta.returnItemsImported
    ? "items"
    : importMeta.returnsImported
      ? "aggregate"
      : "none";

  const partial =
    (importMeta.aggregateImported && !importMeta.itemsImported) ||
    (importMeta.returnsImported && !importMeta.returnItemsImported);

  const salesRows =
    salesSource === "none"
      ? []
      : await querySalesRollup(context, territory, monthParsed.monthStartIso, salesSource, includeMargins);
  const returnsRows =
    returnsSource === "none"
      ? []
      : await queryReturnsRollup(context, territory, monthParsed.monthStartIso, returnsSource);

  const months = await listSalesSectionMonths();
  const comparisonNote =
    months.length >= 2 && months.includes(monthParsed.yyyyMm)
      ? "Сравнение периодов будет доступно при загрузке нескольких месяцев."
      : "Нет данных для сравнения периодов.";

  return {
    month: monthParsed.yyyyMm,
    currency: "RUB",
    vatNote: "Суммы с НДС, ₽",
    dataState: partial ? "partial" : salesRows.length || returnsRows.length ? "loaded" : "not_imported",
    salesSource,
    returnsSource,
    returnsSignedNote:
      "Возвраты в 1С передаются со знаком минус (quantity и income). Объём возвратов показан как в источнике.",
    importMeta,
    macroSummaries: buildMacroSummaries(salesRows, includeMargins),
    categories: mapCategories(salesRows, includeMargins),
    returnsMacroSummaries: buildMacroSummaries(returnsRows, false),
    returnsCategories: mapCategories(returnsRows, false),
    periodComparisonNote: comparisonNote,
  };
}
