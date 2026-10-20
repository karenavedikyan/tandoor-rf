import { parseCatalogDecimal, type DecimalParseResult } from "../onec-catalog/decimal";

/** Parse sale amounts from JSON number or 1C decimal string (comma or dot). */
export function parseSaleDecimal(value: unknown): DecimalParseResult {
  if (value === null || value === undefined) {
    return { ok: false, raw: "", code: "EMPTY" };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, raw: String(value), code: "INVALID_FORMAT" };
    }
    const raw = String(value);
    if (raw.includes("e") || raw.includes("E")) {
      return { ok: false, raw, code: "INVALID_FORMAT" };
    }
    return parseCatalogDecimal(raw.replace(".", ","));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.includes(".")) {
      return parseCatalogDecimal(trimmed.replace(".", ","));
    }
    return parseCatalogDecimal(trimmed);
  }
  return { ok: false, raw: String(value), code: "INVALID_FORMAT" };
}

const NUMERIC_SCALE = 4;

function canonicalSaleDecimalNumeric(numeric: string): string {
  const sign = numeric.startsWith("-") ? "-" : "";
  const unsigned = sign ? numeric.slice(1) : numeric;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const paddedFraction = fractionPart.padEnd(NUMERIC_SCALE, "0").slice(0, NUMERIC_SCALE);
  return `${sign}${integerPart}.${paddedFraction}`;
}

/** Compare monetary strings from JSON and PostgreSQL numeric without float loss. */
export function saleDecimalStringsEqual(a: string, b: string): boolean {
  const left = parseSaleDecimal(a);
  const right = parseSaleDecimal(b);
  if (!left.ok || !right.ok) {
    return a === b;
  }
  return canonicalSaleDecimalNumeric(left.numeric) === canonicalSaleDecimalNumeric(right.numeric);
}
