import { createHash } from "node:crypto";
import { isValidNonZeroUuid, normalizeUuid } from "../onec-clients/uuid";
import { parseSaleDecimal } from "./decimal";
import { normalizeSaleMonth } from "./sale-month";
import { MAX_LEGAL_SALES_BYTES } from "./constants";
import type { LegalSalesParseFailureCode, LegalSalesRoster, ParsedLegalSaleLine } from "./types";

export type LegalSalesParseResult =
  | { ok: true; roster: LegalSalesRoster }
  | { ok: false; code: LegalSalesParseFailureCode; message: string; index?: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readLegalGuid(raw: Record<string, unknown>): string | null {
  const clientInfo = raw.client_info;
  if (!isPlainObject(clientInfo)) {
    return null;
  }
  const id = clientInfo.id;
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  if (!isValidNonZeroUuid(trimmed)) {
    return null;
  }
  return normalizeUuid(trimmed);
}

function readProductType(saleInfo: Record<string, unknown>): string | null {
  const value = saleInfo.type;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readMonthFields(
  raw: Record<string, unknown>,
  saleInfo: Record<string, unknown>,
): ReturnType<typeof normalizeSaleMonth> | { ok: false; code: "MONTH_FIELD_CONFLICT" } {
  const top = "month" in raw ? normalizeSaleMonth(raw.month) : null;
  const inner = "month" in saleInfo ? normalizeSaleMonth(saleInfo.month) : null;
  if (top && !top.ok && inner && inner.ok) {
    return inner;
  }
  if (inner && !inner.ok && top && top.ok) {
    return top;
  }
  if (top && top.ok && inner && inner.ok && top.yyyyMm !== inner.yyyyMm) {
    return { ok: false, code: "MONTH_FIELD_CONFLICT" };
  }
  if (top && top.ok) {
    return top;
  }
  if (inner && inner.ok) {
    return inner;
  }
  if (top && !top.ok) {
    return top;
  }
  if (inner && !inner.ok) {
    return inner;
  }
  return { ok: false, code: "EMPTY" };
}

function lineKey(legalGuid: string, yyyyMm: string, productType: string): string {
  return `${legalGuid.toLowerCase()}|${yyyyMm}|${productType}`;
}

function linesEqual(a: ParsedLegalSaleLine, b: ParsedLegalSaleLine): boolean {
  return (
    a.quantity === b.quantity &&
    a.income === b.income &&
    a.manualDiscount === b.manualDiscount &&
    a.automaticDiscount === b.automaticDiscount &&
    a.totalDiscount === b.totalDiscount &&
    a.costPrice === b.costPrice &&
    a.additionalExpenses === b.additionalExpenses &&
    a.grossProfit === b.grossProfit &&
    a.profitability === b.profitability
  );
}

export function parseLegalSalesJsonBytes(bytes: Buffer): LegalSalesParseResult {
  if (bytes.length > MAX_LEGAL_SALES_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "sale.json exceeds size limit." };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "INVALID_UTF8", message: "sale.json is not valid UTF-8." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "sale.json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", message: "sale.json root must be a JSON array." };
  }

  const byKey = new Map<string, ParsedLegalSaleLine>();
  const lines: ParsedLegalSaleLine[] = [];

  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isPlainObject(item)) {
      return { ok: false, code: "INVALID_RECORD", message: `Invalid record at index ${index}.`, index };
    }
    const legalGuid = readLegalGuid(item);
    if (!legalGuid) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Invalid client_info.id at index ${index}.`,
        index,
      };
    }
    const saleInfo = item.sale_info;
    if (!isPlainObject(saleInfo)) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Missing sale_info at index ${index}.`,
        index,
      };
    }
    const monthParsed = readMonthFields(item, saleInfo);
    if (!monthParsed.ok) {
      const code = "code" in monthParsed && monthParsed.code === "MONTH_FIELD_CONFLICT"
        ? "MONTH_FIELD_CONFLICT"
        : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message:
          code === "MONTH_FIELD_CONFLICT"
            ? `Conflicting month values at index ${index}.`
            : `Invalid month at index ${index}.`,
        index,
      };
    }
    const productType = readProductType(saleInfo);
    if (!productType) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Invalid sale_info.type at index ${index}.`,
        index,
      };
    }

    if (!isPlainObject(saleInfo.discounts)) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Missing sale_info.discounts at index ${index}.`,
        index,
      };
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
        return {
          ok: false,
          code: "INVALID_FIELD",
          message: `Invalid ${field} at index ${index}.`,
          index,
        };
      }
    }

    const row: ParsedLegalSaleLine = {
      legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      quantity: numericFields.quantity.ok ? numericFields.quantity.numeric : "0",
      income: numericFields.income.ok ? numericFields.income.numeric : "0",
      manualDiscount: numericFields.manualDiscount.ok ? numericFields.manualDiscount.numeric : "0",
      automaticDiscount: numericFields.automaticDiscount.ok ? numericFields.automaticDiscount.numeric : "0",
      totalDiscount: numericFields.totalDiscount.ok ? numericFields.totalDiscount.numeric : "0",
      costPrice: numericFields.costPrice.ok ? numericFields.costPrice.numeric : "0",
      additionalExpenses: numericFields.additionalExpenses.ok ? numericFields.additionalExpenses.numeric : "0",
      grossProfit: numericFields.grossProfit.ok ? numericFields.grossProfit.numeric : "0",
      profitability: numericFields.profitability.ok ? numericFields.profitability.numeric : "0",
    };

    const key = lineKey(legalGuid, monthParsed.yyyyMm, productType);
    const existing = byKey.get(key);
    if (existing && !linesEqual(existing, row)) {
      return {
        ok: false,
        code: "DUPLICATE_KEY_CONFLICT",
        message: `Conflicting duplicate for legal ${legalGuid}, month ${monthParsed.yyyyMm}, type ${productType}.`,
        index,
      };
    }
    if (!existing) {
      byKey.set(key, row);
      lines.push(row);
    }
  }

  return {
    ok: true,
    roster: {
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      lines,
      lineCount: lines.length,
    },
  };
}
