import { parseSaleDecimal } from "./decimal";

const MONEY_SCALE = 4;
const QTY_SCALE = 6;
const QTY_INTEGER_DIGITS = 14;

type QuantityParseResult = { ok: true; scaled: bigint } | { ok: false };

/** Quantity strings at scale 6 (item lines); stricter than catalog money parser. */
export function parseSaleQuantityString(value: string): QuantityParseResult {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false };
  }
  const sign = trimmed.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0n ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  if (intPart.replace(/^0+/, "").length > QTY_INTEGER_DIGITS) {
    return { ok: false };
  }
  if (fracPart.length > QTY_SCALE) {
    return { ok: false };
  }
  const padded = fracPart.padEnd(QTY_SCALE, "0");
  const scaled =
    sign *
    (BigInt(intPart || "0") * 10n ** BigInt(QTY_SCALE) + BigInt(padded || "0"));
  return { ok: true, scaled };
}

function toScaledInt(value: string, scale: number): bigint | null {
  if (scale === QTY_SCALE) {
    const parsed = parseSaleQuantityString(value);
    return parsed.ok ? parsed.scaled : null;
  }
  const parsed = parseSaleDecimal(value);
  if (!parsed.ok) {
    return null;
  }
  const sign = parsed.numeric.startsWith("-") ? -1n : 1n;
  const unsigned = parsed.numeric.startsWith("-") ? parsed.numeric.slice(1) : parsed.numeric;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const padded = fracPart.padEnd(scale, "0").slice(0, scale);
  return sign * (BigInt(intPart || "0") * 10n ** BigInt(scale) + BigInt(padded || "0"));
}

function fromScaledInt(value: bigint, scale: number): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const intPart = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(scale, "0");
  return `${sign}${intPart}.${fracStr}`;
}

export function addSaleMoneyStrings(values: string[]): string {
  let sum = 0n;
  for (const v of values) {
    const scaled = toScaledInt(v, MONEY_SCALE);
    if (scaled != null) {
      sum += scaled;
    }
  }
  return fromScaledInt(sum, MONEY_SCALE);
}

export function addSaleQuantityStrings(values: string[]): string {
  let sum = 0n;
  for (const v of values) {
    const parsed = parseSaleQuantityString(v);
    if (parsed.ok) {
      sum += parsed.scaled;
    }
  }
  return fromScaledInt(sum, QTY_SCALE);
}

/** Exact money equality at scale 4 (0.0001 ₽ units). */
export function saleMoneyStringsExactEqual(a: string, b: string): boolean {
  const left = toScaledInt(a, MONEY_SCALE);
  const right = toScaledInt(b, MONEY_SCALE);
  if (left == null || right == null) {
    return a === b;
  }
  return left === right;
}

export function saleQuantityStringsExactEqual(a: string, b: string): boolean {
  const left = parseSaleQuantityString(a);
  const right = parseSaleQuantityString(b);
  if (!left.ok || !right.ok) {
    return a === b;
  }
  return left.scaled === right.scaled;
}

/** toleranceKopecks: max difference in kopecks (1 = 0.01 ₽ at scale 4 → 100 scaled units). */
export function saleMoneyWithinTolerance(a: string, b: string, toleranceKopecks = 0): boolean {
  const left = toScaledInt(a, MONEY_SCALE);
  const right = toScaledInt(b, MONEY_SCALE);
  if (left == null || right == null) {
    return a === b;
  }
  const diff = left > right ? left - right : right - left;
  const toleranceScaled = BigInt(toleranceKopecks) * 100n;
  return diff <= toleranceScaled;
}

export function saleQuantityWithinTolerance(a: string, b: string): boolean {
  return saleQuantityStringsExactEqual(a, b);
}
