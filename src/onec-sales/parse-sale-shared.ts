import { isValidNonZeroUuid, normalizeUuid } from "../onec-clients/uuid";
import { parseSaleDecimal } from "./decimal";
import { normalizeSaleMonth } from "./sale-month";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readProductType(info: Record<string, unknown>): string | null {
  const value = info.type;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readMonthFields(
  raw: Record<string, unknown>,
  inner: Record<string, unknown>,
): ReturnType<typeof normalizeSaleMonth> | { ok: false; code: "MONTH_FIELD_CONFLICT" } {
  const top = "month" in raw ? normalizeSaleMonth(raw.month) : null;
  const nested = "month" in inner ? normalizeSaleMonth(inner.month) : null;
  if (top && !top.ok && nested && nested.ok) {
    return nested;
  }
  if (nested && !nested.ok && top && top.ok) {
    return top;
  }
  if (top && top.ok && nested && nested.ok && top.yyyyMm !== nested.yyyyMm) {
    return { ok: false, code: "MONTH_FIELD_CONFLICT" };
  }
  if (top && top.ok) {
    return top;
  }
  if (nested && nested.ok) {
    return nested;
  }
  if (top && !top.ok) {
    return top;
  }
  if (nested && !nested.ok) {
    return nested;
  }
  return { ok: false, code: "EMPTY" };
}

export type ParsedSaleMetrics = {
  quantity: string;
  income: string;
  manualDiscount: string;
  automaticDiscount: string;
  totalDiscount: string;
  costPrice: string;
  additionalExpenses: string;
  grossProfit: string;
  profitability: string;
};

export function readSaleMetrics(
  saleInfo: Record<string, unknown>,
  index: number,
): { ok: true; metrics: ParsedSaleMetrics } | { ok: false; message: string } {
  if (!isPlainObject(saleInfo.discounts)) {
    return { ok: false, message: `Missing sale_info.discounts at index ${index}.` };
  }
  const numericFields = {
    quantity: parseSaleDecimal(saleInfo.quantity),
    income: parseSaleDecimal(saleInfo.income),
    manualDiscount: parseSaleDecimal(saleInfo.discounts.manual_discount),
    automaticDiscount: parseSaleDecimal(saleInfo.discounts.automatic_discount),
    totalDiscount: parseSaleDecimal(saleInfo.discounts.total_discount),
    costPrice: parseSaleDecimal(saleInfo.cost_price),
    additionalExpenses: parseSaleDecimal(saleInfo.additional_expenses),
    grossProfit: parseSaleDecimal(saleInfo.gross_profit),
    profitability: parseSaleDecimal(saleInfo.profitability),
  };
  for (const [field, result] of Object.entries(numericFields)) {
    if (!result.ok) {
      return { ok: false, message: `Invalid ${field} at index ${index}.` };
    }
  }
  return {
    ok: true,
    metrics: {
      quantity: numericFields.quantity.ok ? numericFields.quantity.numeric : "0",
      income: numericFields.income.ok ? numericFields.income.numeric : "0",
      manualDiscount: numericFields.manualDiscount.ok ? numericFields.manualDiscount.numeric : "0",
      automaticDiscount: numericFields.automaticDiscount.ok ? numericFields.automaticDiscount.numeric : "0",
      totalDiscount: numericFields.totalDiscount.ok ? numericFields.totalDiscount.numeric : "0",
      costPrice: numericFields.costPrice.ok ? numericFields.costPrice.numeric : "0",
      additionalExpenses: numericFields.additionalExpenses.ok ? numericFields.additionalExpenses.numeric : "0",
      grossProfit: numericFields.grossProfit.ok ? numericFields.grossProfit.numeric : "0",
      profitability: numericFields.profitability.ok ? numericFields.profitability.numeric : "0",
    },
  };
}

export function readGuidItem(saleInfo: Record<string, unknown>): string | null {
  const raw = saleInfo.guid_item;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!isValidNonZeroUuid(trimmed)) {
    return null;
  }
  return normalizeUuid(trimmed);
}

export function readNameItem(saleInfo: Record<string, unknown>): string | null {
  const raw = saleInfo.name_item;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
