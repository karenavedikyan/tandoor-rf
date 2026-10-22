import { createHash } from "node:crypto";
import { readLegalEntityGuidFromClientInfo } from "./client-info-legal-guid";
import { MAX_LEGAL_SALES_BYTES } from "./constants";
import {
  isPlainObject,
  readGuidItem,
  readMonthFields,
  readNameItem,
  readProductType,
  readSaleMetrics,
} from "./parse-sale-shared";
import type { LegalSaleItemsRoster, LegalSalesParseFailureCode, ParsedLegalSaleItemLine } from "./types";

export type LegalSaleItemsParseResult =
  | { ok: true; roster: LegalSaleItemsRoster }
  | { ok: false; code: LegalSalesParseFailureCode; message: string; index?: number };

export function parseLegalSaleItemsJsonBytes(bytes: Buffer): LegalSaleItemsParseResult {
  if (bytes.length > MAX_LEGAL_SALES_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "sale(items).json exceeds size limit." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "sale(items).json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", message: "sale(items).json root must be a JSON array." };
  }

  const lines: ParsedLegalSaleItemLine[] = [];
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
      return {
        ok: false,
        code,
        message:
          legalParsed.code === "CLIENT_INFO_GUID_ID_CONFLICT"
            ? `Conflicting client_info.guid and client_info.id at index ${index}.`
            : `Invalid client_info at index ${index}.`,
        index,
      };
    }
    const saleInfo = item.sale_info;
    if (!isPlainObject(saleInfo)) {
      return { ok: false, code: "INVALID_FIELD", message: `Missing sale_info at index ${index}.`, index };
    }
    const monthParsed = readMonthFields(item, saleInfo);
    if (!monthParsed.ok) {
      const code =
        "code" in monthParsed && monthParsed.code === "MONTH_FIELD_CONFLICT"
          ? "MONTH_FIELD_CONFLICT"
          : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message:
          code === "MONTH_FIELD_CONFLICT"
            ? `Conflicting month at index ${index}.`
            : `Invalid month at index ${index}.`,
        index,
      };
    }
    const productType = readProductType(saleInfo);
    if (!productType) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid sale_info.type at index ${index}.`, index };
    }
    const guidItem = readGuidItem(saleInfo);
    const nameItem = readNameItem(saleInfo);
    if (!guidItem || !nameItem) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Missing sale_info.guid_item or name_item at index ${index}.`,
        index,
      };
    }
    const metricsParsed = readSaleMetrics(saleInfo, index);
    if (!metricsParsed.ok) {
      return { ok: false, code: "INVALID_FIELD", message: metricsParsed.message, index };
    }
    lines.push({
      sourceRowIndex: index,
      legalGuid: legalParsed.legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      guidItem,
      nameItem,
      ...metricsParsed.metrics,
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
