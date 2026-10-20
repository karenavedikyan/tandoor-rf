import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { resolveV3EntityAccess } from "./detail";
import { normalizeSaleMonth } from "../../onec-sales/sale-month";

export type LegalSalesLineDto = {
  productType: string;
  quantity: string;
  income: string;
  manualDiscount: string;
  automaticDiscount: string;
  totalDiscount: string;
  costPrice?: string;
  additionalExpenses?: string;
  grossProfit?: string;
  profitability?: string;
};

export type LegalSalesMonthSummary = {
  month: string;
  currency: "RUB";
  vatNote: string;
  quantityTotal: string;
  incomeTotal: string;
  grossProfitTotal: string | null;
  profitabilityPercent: string | null;
  lines: LegalSalesLineDto[];
};

function canViewMarginFields(context: AccessContext): boolean {
  return context.role === "admin" || context.fullClientBase;
}

export async function getLegalSalesImportMeta(): Promise<{
  rowCount: number;
  importedAt: string | null;
  sourceSha256: string | null;
} | null> {
  const rows = await query<{
    row_count: number;
    imported_at: string | null;
    source_sha256: string | null;
  }>(
    `
      SELECT row_count, imported_at::text, source_sha256
      FROM onec_v3_legal_sales_import_state
      WHERE id = 1
      LIMIT 1
    `,
  );
  if (!rows.rows.length) {
    return null;
  }
  const row = rows.rows[0];
  return {
    rowCount: Number(row.row_count ?? 0),
    importedAt: row.imported_at,
    sourceSha256: row.source_sha256,
  };
}

export async function listLegalSalesMonths(
  context: AccessContext,
  legalGuid: string,
): Promise<string[] | null> {
  const access = await resolveV3EntityAccess(context, "legal", legalGuid);
  if (access !== "visible") {
    return null;
  }
  const rows = await query<{ month: string }>(
    `
      SELECT DISTINCT to_char(sale_month, 'YYYY-MM') AS month
      FROM onec_v3_legal_sales_lines
      WHERE legal_guid = $1::uuid
      ORDER BY month DESC
    `,
    [legalGuid],
  );
  return rows.rows.map((row) => row.month);
}

export async function getLegalSalesForMonth(
  context: AccessContext,
  legalGuid: string,
  monthRaw: string,
): Promise<LegalSalesMonthSummary | null | "invalid_month"> {
  const monthParsed = normalizeSaleMonth(monthRaw.length === 7 ? monthRaw : `${monthRaw}-01`);
  if (!monthParsed.ok) {
    return "invalid_month";
  }
  const access = await resolveV3EntityAccess(context, "legal", legalGuid);
  if (access !== "visible") {
    return null;
  }

  const includeMargins = canViewMarginFields(context);
  const lineRows = await query<{
    product_type: string;
    quantity: string;
    income: string;
    manual_discount: string;
    automatic_discount: string;
    total_discount: string;
    cost_price: string;
    additional_expenses: string;
    gross_profit: string;
    profitability: string;
  }>(
    `
      SELECT
        product_type,
        quantity::text,
        income::text,
        manual_discount::text,
        automatic_discount::text,
        total_discount::text,
        cost_price::text,
        additional_expenses::text,
        gross_profit::text,
        profitability::text
      FROM onec_v3_legal_sales_lines
      WHERE legal_guid = $1::uuid AND sale_month = $2::date
      ORDER BY product_type ASC
    `,
    [legalGuid, monthParsed.monthStartIso],
  );

  if (lineRows.rows.length === 0) {
    return {
      month: monthParsed.yyyyMm,
      currency: "RUB",
      vatNote: "Суммы с НДС, ₽",
      quantityTotal: "0",
      incomeTotal: "0",
      grossProfitTotal: includeMargins ? "0" : null,
      profitabilityPercent: null,
      lines: [],
    };
  }

  const totals = await query<{
    quantity_total: string;
    income_total: string;
    gross_profit_total: string;
  }>(
    `
      SELECT
        COALESCE(SUM(quantity), 0)::text AS quantity_total,
        COALESCE(SUM(income), 0)::text AS income_total,
        COALESCE(SUM(gross_profit), 0)::text AS gross_profit_total
      FROM onec_v3_legal_sales_lines
      WHERE legal_guid = $1::uuid AND sale_month = $2::date
    `,
    [legalGuid, monthParsed.monthStartIso],
  );
  const totalRow = totals.rows[0]!;
  const incomeTotal = totalRow.income_total;
  const incomeNum = Number(incomeTotal);
  let profitabilityPercent: string | null = null;
  if (includeMargins && incomeNum !== 0) {
    const gp = Number(totalRow.gross_profit_total);
    profitabilityPercent = ((gp / incomeNum) * 100).toFixed(2);
  }

  const lines: LegalSalesLineDto[] = lineRows.rows.map((row) => {
    const base: LegalSalesLineDto = {
      productType: row.product_type,
      quantity: row.quantity,
      income: row.income,
      manualDiscount: row.manual_discount,
      automaticDiscount: row.automatic_discount,
      totalDiscount: row.total_discount,
    };
    if (includeMargins) {
      base.costPrice = row.cost_price;
      base.additionalExpenses = row.additional_expenses;
      base.grossProfit = row.gross_profit;
      base.profitability = row.profitability;
    }
    return base;
  });

  return {
    month: monthParsed.yyyyMm,
    currency: "RUB",
    vatNote: "Суммы с НДС, ₽",
    quantityTotal: totalRow.quantity_total,
    incomeTotal,
    grossProfitTotal: includeMargins ? totalRow.gross_profit_total : null,
    profitabilityPercent,
    lines,
  };
}
