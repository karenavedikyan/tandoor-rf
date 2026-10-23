import { createHash } from "node:crypto";
import { readLegalEntityGuidFromClientInfo } from "./client-info-legal-guid";
import { parseSaleDecimal } from "./decimal";
import { MAX_LEGAL_SALES_BYTES } from "./constants";
import { isPlainObject, readMonthFields, readProductType } from "./parse-sale-shared";
import type { LegalReturnsRoster, LegalSalesParseFailureCode, ParsedLegalReturnLine } from "./types";

export type LegalReturnsParseResult =
  | { ok: true; roster: LegalReturnsRoster }
  | { ok: false; code: LegalSalesParseFailureCode; message: string; index?: number };

export function parseLegalReturnsJsonBytes(bytes: Buffer): LegalReturnsParseResult {
  if (bytes.length > MAX_LEGAL_SALES_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "returne.json exceeds size limit." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "returne.json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", message: "returne.json root must be a JSON array." };
  }

  const lines: ParsedLegalReturnLine[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isPlainObject(item)) {
      return { ok: false, code: "INVALID_RECORD", message: `Invalid record at index ${index}.`, index };
    }
    const legalParsed = readLegalEntityGuidFromClientInfo(item.client_info);
    if (!legalParsed.ok) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid client_info at index ${index}.`, index };
    }
    const returnInfo = item.returne_info;
    if (!isPlainObject(returnInfo)) {
      return { ok: false, code: "INVALID_FIELD", message: `Missing returne_info at index ${index}.`, index };
    }
    const monthParsed = readMonthFields(item, returnInfo);
    if (!monthParsed.ok) {
      const code =
        "code" in monthParsed && monthParsed.code === "MONTH_FIELD_CONFLICT"
          ? "MONTH_FIELD_CONFLICT"
          : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message: code === "MONTH_FIELD_CONFLICT" ? `Conflicting month at index ${index}.` : `Invalid month at index ${index}.`,
        index,
      };
    }
    const productType = readProductType(returnInfo);
    if (!productType) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid returne_info.type at index ${index}.`, index };
    }
    const quantity = parseSaleDecimal(returnInfo.quantity);
    const income = parseSaleDecimal(returnInfo.income);
    if (!quantity.ok || !income.ok) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid quantity/income at index ${index}.`, index };
    }
    lines.push({
      sourceRowIndex: index,
      legalGuid: legalParsed.legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      quantity: quantity.numeric,
      income: income.numeric,
    });
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
