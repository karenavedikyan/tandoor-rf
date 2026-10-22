import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { v3EntityAssignmentScope } from "./access-scope";
import { appendAssignmentFilters, type V3ListQuery, type V3ResponsibleKind } from "./list";
import { normalizeSaleMonth } from "../../onec-sales/sale-month";
import { saleMacroGroup, saleMacroGroupLabel, type SaleMacroGroup } from "../../onec-sales/product-type-groups";
import {
  loadSalesImportSnapshotState,
  monthHasReturnAggregate,
  monthHasReturnItems,
  monthHasSaleAggregate,
  monthHasSaleItems,
  type SalesImportSnapshotState,
} from "../../onec-sales/import-snapshot";
import { addSaleMoneyStrings, addSaleQuantityStrings } from "../../onec-sales/decimal-sum";
import { resolveSalesSectionFieldPolicy, type SalesSectionFieldPolicy } from "./sales-field-policy";

export type SalesSectionTerritory = {
  ropBranchGuid?: string;
  responsibleGuid?: string;
  responsibleKind?: V3ResponsibleKind;
  managerGuid?: string;
  teamMemberGuids?: string[];
};

export type SalesSectionImportMeta = {
  schemaReady: boolean;
  salesSource: "items" | "aggregate" | "none";
  returnsSource: "items" | "aggregate" | "none";
  scopedMatchedSalesRows: number;
  scopedQuarantinedSalesRows: number;
  scopedMatchedReturnRows: number;
};

export type SalesSectionCategoryRow = {
  productType: string;
  macroGroup: SaleMacroGroup;
  quantity: string;
  income: string;
  manualDiscount?: string | null;
  automaticDiscount?: string | null;
  totalDiscount?: string | null;
  costPrice?: string | null;
  additionalExpenses?: string | null;
  grossProfit?: string | null;
  profitabilityPercent?: string | null;
};

export type SalesSectionMacroSummary = {
  group: SaleMacroGroup;
  label: string;
  quantity: string;
  income: string;
  grossProfit?: string | null;
  profitabilityPercent?: string | null;
};

export type SalesSectionSkuRow = {
  guidItem: string;
  nameItem: string;
  productType: string;
  quantity: string;
  income: string;
};

export type SalesSectionClientRow = {
  legalGuid: string;
  legalName: string;
  quantity: string;
  income: string;
};

export type SalesSectionOverview = {
  month: string;
  currency: "RUB";
  vatNote: string;
  dataState: "schema_not_ready" | "not_imported" | "partial" | "loaded";
  salesSource: "items" | "aggregate" | "none";
  returnsSource: "items" | "aggregate" | "none";
  returnsSignedNote: string;
  importMeta: SalesSectionImportMeta;
  fieldPolicy: SalesSectionFieldPolicy;
  macroSummaries: SalesSectionMacroSummary[];
  categories: SalesSectionCategoryRow[];
  returnsMacroSummaries: SalesSectionMacroSummary[];
  returnsCategories: SalesSectionCategoryRow[];
  periodComparisonNote: string;
};

export async function resolveMonthSalesSource(
  snapshot: SalesImportSnapshotState,
  monthIso: string,
): Promise<"items" | "aggregate" | "none"> {
  if (snapshot.saleItemsSha && (await monthHasSaleItems(snapshot.saleItemsSha, monthIso))) {
    return "items";
  }
  if (await monthHasSaleAggregate(monthIso)) {
    return "aggregate";
  }
  return "none";
}

export async function resolveMonthReturnsSource(
  snapshot: SalesImportSnapshotState,
  monthIso: string,
): Promise<"items" | "aggregate" | "none"> {
  if (snapshot.returnItemsSha && (await monthHasReturnItems(snapshot.returnItemsSha, monthIso))) {
    return "items";
  }
  if (snapshot.returnsAggregateSha && (await monthHasReturnAggregate(snapshot.returnsAggregateSha, monthIso))) {
    return "aggregate";
  }
  return "none";
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
  manual_discount: string;
  automatic_discount: string;
  total_discount: string;
  cost_price: string;
  additional_expenses: string;
  gross_profit: string;
};

function weightedProfitability(income: string, grossProfit: string): string | null {
  const incomeNum = Number(income);
  if (!Number.isFinite(incomeNum) || incomeNum === 0) {
    return null;
  }
  const gp = Number(grossProfit);
  return ((gp / incomeNum) * 100).toFixed(2);
}

function applyFieldPolicyToCategory(row: AggRow, policy: SalesSectionFieldPolicy): SalesSectionCategoryRow {
  const base: SalesSectionCategoryRow = {
    productType: row.product_type,
    macroGroup: saleMacroGroup(row.product_type),
    quantity: row.quantity,
    income: row.income,
  };
  if (policy.manualDiscount) {
    base.manualDiscount = row.manual_discount;
  }
  if (policy.automaticDiscount) {
    base.automaticDiscount = row.automatic_discount;
  }
  if (policy.totalDiscount) {
    base.totalDiscount = row.total_discount;
  }
  if (policy.costPrice) {
    base.costPrice = row.cost_price;
  }
  if (policy.additionalExpenses) {
    base.additionalExpenses = row.additional_expenses;
  }
  if (policy.grossProfit) {
    base.grossProfit = row.gross_profit;
  }
  if (policy.profitability) {
    base.profitabilityPercent = weightedProfitability(row.income, row.gross_profit);
  }
  return base;
}

async function querySalesRollup(
  context: AccessContext,
  territory: SalesSectionTerritory,
  monthIso: string,
  source: "items" | "aggregate",
  activeSha: string | null,
): Promise<AggRow[]> {
  const { clause, params } = buildScopeSql(context, territory);
  const table =
    source === "items" ? "onec_v3_legal_sale_item_lines" : "onec_v3_legal_sales_lines";
  const shaFilter =
    source === "items" && activeSha
      ? ` AND sl.source_sha256 = $${params.length + 2}`
      : source === "aggregate" && activeSha
        ? ` AND sl.source_sha256 = $${params.length + 2}`
        : "";
  const matchedFilter = source === "items" ? " AND sl.catalog_matched = TRUE" : "";
  const queryParams = [...params, monthIso];
  if (shaFilter && activeSha) {
    queryParams.push(activeSha);
  }
  const result = await query<AggRow>(
    `
      SELECT
        sl.product_type,
        COALESCE(SUM(sl.quantity), 0)::text AS quantity,
        COALESCE(SUM(sl.income), 0)::text AS income,
        COALESCE(SUM(sl.manual_discount), 0)::text AS manual_discount,
        COALESCE(SUM(sl.automatic_discount), 0)::text AS automatic_discount,
        COALESCE(SUM(sl.total_discount), 0)::text AS total_discount,
        COALESCE(SUM(sl.cost_price), 0)::text AS cost_price,
        COALESCE(SUM(sl.additional_expenses), 0)::text AS additional_expenses,
        COALESCE(SUM(sl.gross_profit), 0)::text AS gross_profit
      FROM ${table} AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE sl.sale_month = $${params.length + 1}::date
        AND (${clause})
        ${matchedFilter}
        ${shaFilter}
      GROUP BY sl.product_type
      ORDER BY sl.product_type ASC
    `,
    queryParams,
  );
  return result.rows;
}

async function queryReturnsRollup(
  context: AccessContext,
  territory: SalesSectionTerritory,
  monthIso: string,
  source: "items" | "aggregate",
  activeSha: string | null,
): Promise<AggRow[]> {
  const { clause, params } = buildScopeSql(context, territory);
  const table = source === "items" ? "onec_v3_legal_return_item_lines" : "onec_v3_legal_return_lines";
  const shaFilter = activeSha ? ` AND sl.source_sha256 = $${params.length + 2}` : "";
  const queryParams = [...params, monthIso];
  if (activeSha) {
    queryParams.push(activeSha);
  }
  const result = await query<AggRow>(
    `
      SELECT
        sl.product_type,
        COALESCE(SUM(sl.quantity), 0)::text AS quantity,
        COALESCE(SUM(sl.income), 0)::text AS income,
        '0'::text AS manual_discount,
        '0'::text AS automatic_discount,
        '0'::text AS total_discount,
        '0'::text AS cost_price,
        '0'::text AS additional_expenses,
        '0'::text AS gross_profit
      FROM ${table} AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE sl.sale_month = $${params.length + 1}::date
        AND (${clause})
        AND sl.catalog_matched = TRUE
        ${shaFilter}
      GROUP BY sl.product_type
      ORDER BY sl.product_type ASC
    `,
    queryParams,
  );
  return result.rows;
}

function buildMacroSummaries(rows: SalesSectionCategoryRow[], policy: SalesSectionFieldPolicy): SalesSectionMacroSummary[] {
  const buckets = new Map<
    SaleMacroGroup,
    { quantity: string[]; income: string[]; gross: string[] }
  >();
  for (const row of rows) {
    const macro = row.macroGroup;
    const bucket = buckets.get(macro) ?? { quantity: [], income: [], gross: [] };
    bucket.quantity.push(row.quantity);
    bucket.income.push(row.income);
    if (policy.grossProfit && row.grossProfit != null) {
      bucket.gross.push(row.grossProfit);
    }
    buckets.set(macro, bucket);
  }
  const order: SaleMacroGroup[] = ["vh", "mk", "furniture", "other"];
  return order
    .filter((g) => buckets.has(g))
    .map((group) => {
      const b = buckets.get(group)!;
      const income = addSaleMoneyStrings(b.income);
      const gross = policy.grossProfit ? addSaleMoneyStrings(b.gross) : null;
      return {
        group,
        label: saleMacroGroupLabel(group),
        quantity: addSaleQuantityStrings(b.quantity),
        income,
        grossProfit: gross,
        profitabilityPercent:
          policy.profitability && gross != null ? weightedProfitability(income, gross) : null,
      };
    });
}

async function countScopedRows(
  context: AccessContext,
  territory: SalesSectionTerritory,
  monthIso: string,
  table: string,
  activeSha: string | null,
  matchedOnly: boolean,
): Promise<number> {
  const { clause, params } = buildScopeSql(context, territory);
  const shaFilter = activeSha ? ` AND sl.source_sha256 = $${params.length + 2}` : "";
  const matchedFilter = matchedOnly ? " AND sl.catalog_matched = TRUE" : " AND sl.catalog_matched = FALSE";
  const queryParams = [...params, monthIso];
  if (activeSha) {
    queryParams.push(activeSha);
  }
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM ${table} AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE sl.sale_month = $${params.length + 1}::date
        AND (${clause})
        ${matchedFilter}
        ${shaFilter}
    `,
    queryParams,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function listSalesSectionMonths(
  context: AccessContext,
  territory: SalesSectionTerritory,
): Promise<string[]> {
  const snapshot = await loadSalesImportSnapshotState();
  if (!snapshot.schemaReady) {
    return [];
  }
  const { clause, params } = buildScopeSql(context, territory);
  const result = await query<{ month: string }>(
    `
      SELECT DISTINCT to_char(sl.sale_month, 'YYYY-MM') AS month
      FROM (
        SELECT sl.sale_month, sl.legal_guid FROM onec_v3_legal_sales_lines sl
        UNION ALL
        SELECT sl.sale_month, sl.legal_guid FROM onec_v3_legal_sale_item_lines sl
          WHERE sl.catalog_matched = TRUE
            AND ($${params.length + 1}::text IS NULL OR sl.source_sha256 = $${params.length + 1})
        UNION ALL
        SELECT sl.sale_month, sl.legal_guid FROM onec_v3_legal_return_lines sl
          WHERE sl.catalog_matched = TRUE
            AND ($${params.length + 2}::text IS NULL OR sl.source_sha256 = $${params.length + 2})
        UNION ALL
        SELECT sl.sale_month, sl.legal_guid FROM onec_v3_legal_return_item_lines sl
          WHERE sl.catalog_matched = TRUE
            AND ($${params.length + 3}::text IS NULL OR sl.source_sha256 = $${params.length + 3})
      ) AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE (${clause})
      ORDER BY month DESC
    `,
    [...params, snapshot.saleItemsSha, snapshot.returnsAggregateSha, snapshot.returnItemsSha],
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
  const fieldPolicy = resolveSalesSectionFieldPolicy(context);
  const snapshot = await loadSalesImportSnapshotState();
  if (!snapshot.schemaReady) {
    return {
      month: monthParsed.yyyyMm,
      currency: "RUB",
      vatNote: "Суммы с НДС, ₽",
      dataState: "schema_not_ready",
      salesSource: "none",
      returnsSource: "none",
      returnsSignedNote:
        "Возвраты в 1С передаются со знаком минус (quantity и income). Объём возвратов показан как в источнике.",
      importMeta: {
        schemaReady: false,
        salesSource: "none",
        returnsSource: "none",
        scopedMatchedSalesRows: 0,
        scopedQuarantinedSalesRows: 0,
        scopedMatchedReturnRows: 0,
      },
      fieldPolicy,
      macroSummaries: [],
      categories: [],
      returnsMacroSummaries: [],
      returnsCategories: [],
      periodComparisonNote: "Нет данных для сравнения периодов.",
    };
  }

  const salesSource = await resolveMonthSalesSource(snapshot, monthParsed.monthStartIso);
  const returnsSource = await resolveMonthReturnsSource(snapshot, monthParsed.monthStartIso);
  const salesActiveSha =
    salesSource === "items" ? snapshot.saleItemsSha : snapshot.saleAggregateSha;
  const returnsActiveSha =
    returnsSource === "items" ? snapshot.returnItemsSha : snapshot.returnsAggregateSha;

  const salesRowsRaw =
    salesSource === "none"
      ? []
      : await querySalesRollup(
          context,
          territory,
          monthParsed.monthStartIso,
          salesSource,
          salesActiveSha,
        );
  const returnsRowsRaw =
    returnsSource === "none"
      ? []
      : await queryReturnsRollup(
          context,
          territory,
          monthParsed.monthStartIso,
          returnsSource,
          returnsActiveSha,
        );

  const categories = salesRowsRaw.map((row) => applyFieldPolicyToCategory(row, fieldPolicy));
  const returnsCategories = returnsRowsRaw.map((row) => applyFieldPolicyToCategory(row, fieldPolicy));

  const scopedMatchedSalesRows =
    salesSource === "items"
      ? await countScopedRows(
          context,
          territory,
          monthParsed.monthStartIso,
          "onec_v3_legal_sale_item_lines",
          snapshot.saleItemsSha,
          true,
        )
      : salesRowsRaw.length > 0
        ? 1
        : 0;
  const scopedQuarantinedSalesRows =
    salesSource === "items"
      ? await countScopedRows(
          context,
          territory,
          monthParsed.monthStartIso,
          "onec_v3_legal_sale_item_lines",
          snapshot.saleItemsSha,
          false,
        )
      : 0;

  const months = await listSalesSectionMonths(context, territory);
  const hasData = categories.length > 0 || returnsCategories.length > 0;

  return {
    month: monthParsed.yyyyMm,
    currency: "RUB",
    vatNote: "Суммы с НДС, ₽",
    dataState: hasData ? "loaded" : "not_imported",
    salesSource,
    returnsSource,
    returnsSignedNote:
      "Возвраты в 1С передаются со знаком минус (quantity и income). Объём возвратов показан как в источнике.",
    importMeta: {
      schemaReady: true,
      salesSource,
      returnsSource,
      scopedMatchedSalesRows,
      scopedQuarantinedSalesRows,
      scopedMatchedReturnRows:
        returnsSource === "none"
          ? 0
          : await countScopedRows(
              context,
              territory,
              monthParsed.monthStartIso,
              returnsSource === "items"
                ? "onec_v3_legal_return_item_lines"
                : "onec_v3_legal_return_lines",
              returnsActiveSha,
              true,
            ),
    },
    fieldPolicy,
    macroSummaries: buildMacroSummaries(categories, fieldPolicy),
    categories,
    returnsMacroSummaries: buildMacroSummaries(returnsCategories, fieldPolicy),
    returnsCategories,
    periodComparisonNote:
      months.length >= 2 ? "Сравнение периодов будет доступно при загрузке нескольких месяцев." : "Нет данных для сравнения периодов.",
  };
}

export async function listSalesSectionSkuRows(
  context: AccessContext,
  territory: SalesSectionTerritory,
  monthRaw: string,
  productType: string,
  kind: "sales" | "returns",
): Promise<SalesSectionSkuRow[] | "invalid_month" | "no_items_source"> {
  const monthParsed = normalizeSaleMonth(monthRaw.length === 7 ? monthRaw : `${monthRaw}-01`);
  if (!monthParsed.ok) {
    return "invalid_month";
  }
  const snapshot = await loadSalesImportSnapshotState();
  if (!snapshot.schemaReady) {
    return [];
  }
  const source =
    kind === "sales"
      ? await resolveMonthSalesSource(snapshot, monthParsed.monthStartIso)
      : await resolveMonthReturnsSource(snapshot, monthParsed.monthStartIso);
  if (source !== "items") {
    return "no_items_source";
  }
  const activeSha = kind === "sales" ? snapshot.saleItemsSha : snapshot.returnItemsSha;
  const table =
    kind === "sales" ? "onec_v3_legal_sale_item_lines" : "onec_v3_legal_return_item_lines";
  const { clause, params } = buildScopeSql(context, territory);
  const result = await query<{
    guid_item: string;
    name_item: string;
    product_type: string;
    quantity: string;
    income: string;
  }>(
    `
      SELECT
        sl.guid_item::text,
        sl.name_item,
        sl.product_type,
        COALESCE(SUM(sl.quantity), 0)::text AS quantity,
        COALESCE(SUM(sl.income), 0)::text AS income
      FROM ${table} AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE sl.sale_month = $${params.length + 1}::date
        AND sl.product_type = $${params.length + 2}
        AND sl.source_sha256 = $${params.length + 3}
        AND sl.catalog_matched = TRUE
        AND (${clause})
      GROUP BY sl.guid_item, sl.name_item, sl.product_type
      ORDER BY sl.name_item ASC
    `,
    [...params, monthParsed.monthStartIso, productType, activeSha],
  );
  return result.rows.map((row) => ({
    guidItem: row.guid_item,
    nameItem: row.name_item,
    productType: row.product_type,
    quantity: row.quantity,
    income: row.income,
  }));
}

export async function listSalesSectionClientRows(
  context: AccessContext,
  territory: SalesSectionTerritory,
  monthRaw: string,
  productType: string,
  guidItem: string,
  kind: "sales" | "returns",
): Promise<SalesSectionClientRow[] | "invalid_month"> {
  const monthParsed = normalizeSaleMonth(monthRaw.length === 7 ? monthRaw : `${monthRaw}-01`);
  if (!monthParsed.ok) {
    return "invalid_month";
  }
  const snapshot = await loadSalesImportSnapshotState();
  if (!snapshot.schemaReady) {
    return [];
  }
  const source =
    kind === "sales"
      ? await resolveMonthSalesSource(snapshot, monthParsed.monthStartIso)
      : await resolveMonthReturnsSource(snapshot, monthParsed.monthStartIso);
  const activeSha =
    source === "items"
      ? kind === "sales"
        ? snapshot.saleItemsSha
        : snapshot.returnItemsSha
      : kind === "sales"
        ? snapshot.saleAggregateSha
        : snapshot.returnsAggregateSha;
  const table =
    source === "items"
      ? kind === "sales"
        ? "onec_v3_legal_sale_item_lines"
        : "onec_v3_legal_return_item_lines"
      : kind === "sales"
        ? "onec_v3_legal_sales_lines"
        : "onec_v3_legal_return_lines";
  const { clause, params } = buildScopeSql(context, territory);
  const itemFilter =
    source === "items" ? ` AND sl.guid_item = $${params.length + 4}::uuid` : "";
  const queryParams = [...params, monthParsed.monthStartIso, productType, activeSha];
  if (source === "items") {
    queryParams.push(guidItem);
  }
  const matchedSql = source === "items" ? " AND sl.catalog_matched = TRUE" : "";
  const result = await query<{
    legal_guid: string;
    name_client: string;
    quantity: string;
    income: string;
  }>(
    `
      SELECT
        le.guid_client::text AS legal_guid,
        le.name_client,
        COALESCE(SUM(sl.quantity), 0)::text AS quantity,
        COALESCE(SUM(sl.income), 0)::text AS income
      FROM ${table} AS sl
      INNER JOIN onec_v3_legal_entities AS le ON le.guid_client = sl.legal_guid
      WHERE sl.sale_month = $${params.length + 1}::date
        AND sl.product_type = $${params.length + 2}
        AND sl.source_sha256 = $${params.length + 3}
        ${matchedSql}
        ${itemFilter}
        AND (${clause})
      GROUP BY le.guid_client, le.name_client
      ORDER BY le.name_client ASC
    `,
    queryParams,
  );
  return result.rows.map((row) => ({
    legalGuid: row.legal_guid,
    legalName: row.name_client,
    quantity: row.quantity,
    income: row.income,
  }));
}
