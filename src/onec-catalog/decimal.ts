export type DecimalParseFailureCode =
  | "EMPTY"
  | "INVALID_FORMAT"
  | "NUMERIC_OVERFLOW"
  | "NUMERIC_SCALE";

export type DecimalParseResult =
  | { ok: true; numeric: string; raw: string }
  | { ok: false; raw: string; code: DecimalParseFailureCode };

const NUMERIC_INTEGER_DIGITS = 14;
const NUMERIC_FRACTION_DIGITS = 4;

/** Parse 1C decimal with comma separator without float rounding. */
export function parseCatalogDecimal(raw: string): DecimalParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, raw: trimmed, code: "EMPTY" };
  }
  if (!/^-?\d+(,\d+)?$/.test(trimmed)) {
    return { ok: false, raw: trimmed, code: "INVALID_FORMAT" };
  }
  const normalized = trimmed.replace(",", ".");
  const sign = normalized.startsWith("-") ? "-" : "";
  const unsigned = sign ? normalized.slice(1) : normalized;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  if (integerPart.length > NUMERIC_INTEGER_DIGITS) {
    return { ok: false, raw: trimmed, code: "NUMERIC_OVERFLOW" };
  }
  if (fractionPart.length > NUMERIC_FRACTION_DIGITS) {
    return { ok: false, raw: trimmed, code: "NUMERIC_SCALE" };
  }
  return { ok: true, numeric: `${sign}${unsigned}`, raw: trimmed };
}

export function mapDecimalFailureToQuarantine(code: DecimalParseFailureCode): string {
  switch (code) {
    case "NUMERIC_OVERFLOW":
    case "NUMERIC_SCALE":
      return "NUMERIC_OUT_OF_RANGE";
    default:
      return "INVALID_DECIMAL";
  }
}
