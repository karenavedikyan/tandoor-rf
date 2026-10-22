import { parseSaleDecimal } from "./decimal";

const MONEY_SCALE = 4;
const QTY_SCALE = 6;

function toScaledInt(value: string, scale: number): bigint | null {
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
    const scaled = toScaledInt(v, QTY_SCALE);
    if (scaled != null) {
      sum += scaled;
    }
  }
  return fromScaledInt(sum, QTY_SCALE);
}

export function saleMoneyWithinTolerance(a: string, b: string, toleranceCents = 1): boolean {
  const left = toScaledInt(a, MONEY_SCALE);
  const right = toScaledInt(b, MONEY_SCALE);
  if (left == null || right == null) {
    return a === b;
  }
  const diff = left > right ? left - right : right - left;
  return diff <= BigInt(toleranceCents);
}

export function saleQuantityWithinTolerance(a: string, b: string): boolean {
  const left = toScaledInt(a, QTY_SCALE);
  const right = toScaledInt(b, QTY_SCALE);
  if (left == null || right == null) {
    return a === b;
  }
  const diff = left > right ? left - right : right - left;
  return diff <= 1n;
}
