import { createHash } from "node:crypto";
import { readLegalEntityGuidFromClientInfo } from "./client-info-legal-guid";
import { MAX_LEGAL_SALES_BYTES } from "./constants";
import {
  isPlainObject,
  readMonthFields,
  readProductType,
  readSaleMetrics,
} from "./parse-sale-shared";
import type { LegalSalesParseFailureCode, LegalSalesRoster, ParsedLegalSaleLine } from "./types";

export type LegalSalesParseResult =
  | { ok: true; roster: LegalSalesRoster }
  | { ok: false; code: LegalSalesParseFailureCode; message: string; index?: number };

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
    const legalParsed = readLegalEntityGuidFromClientInfo(item.client_info);
    if (!legalParsed.ok) {
      const code =
        legalParsed.code === "CLIENT_INFO_GUID_ID_CONFLICT"
          ? "CLIENT_INFO_GUID_ID_CONFLICT"
          : "INVALID_FIELD";
      const message =
        legalParsed.code === "CLIENT_INFO_GUID_ID_CONFLICT"
          ? `Conflicting client_info.guid and client_info.id at index ${index}.`
          : legalParsed.code === "MISSING_CLIENT_INFO"
            ? `Missing client_info at index ${index}.`
            : `Invalid client_info legal guid at index ${index}.`;
      return { ok: false, code, message, index };
    }
    const legalGuid = legalParsed.legalGuid;
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

    const metricsParsed = readSaleMetrics(saleInfo, index);
    if (!metricsParsed.ok) {
      return { ok: false, code: "INVALID_FIELD", message: metricsParsed.message, index };
    }
    const metrics = metricsParsed.metrics;

    const row: ParsedLegalSaleLine = {
      sourceRowIndex: index,
      legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      ...metrics,
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
