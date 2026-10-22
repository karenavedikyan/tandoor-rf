/** Matches parseV3FilterRulesParam number validation in list-field-rules.ts */
export const PLAIN_DECIMAL_FILTER_RE = /^-?\d+(\.\d+)?$/;

const MAX_TOTAL_DIGITS = 40;
const MAX_INPUT_CHARS = 80;
const MAX_EXPONENT_MAG = 60;

export type NormalizeListFilterNumberResult =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "invalid" };

export function normalizeListFilterNumberValue(raw: string): NormalizeListFilterNumberResult {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || trimmed === "-") {
    return { ok: false, reason: "empty" };
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    return { ok: false, reason: "invalid" };
  }
  if (/^0[xX]/.test(trimmed)) {
    return { ok: false, reason: "invalid" };
  }
  if (/[eE]/.test(trimmed)) {
    return expandScientificNotation(trimmed);
  }
  const plain = canonicalizePlainDecimal(trimmed);
  if (!plain) {
    return { ok: false, reason: "invalid" };
  }
  if (!PLAIN_DECIMAL_FILTER_RE.test(plain)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: plain };
}

function safeRepeatZero(count: number): string | null {
  if (count < 0 || count > MAX_TOTAL_DIGITS) {
    return null;
  }
  let out = "";
  for (let i = 0; i < count; i++) {
    out += "0";
  }
  return out;
}

function parseFiniteExponent(expStr: string): number | null {
  if (!/^-?\d+$/.test(expStr)) {
    return null;
  }
  const unsigned = expStr.startsWith("-") ? expStr.slice(1) : expStr;
  if (!unsigned || unsigned.length > 4) {
    return null;
  }
  const value = Number(expStr);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  if (Math.abs(value) > MAX_EXPONENT_MAG) {
    return null;
  }
  return value;
}

function canonicalizePlainDecimal(raw: string): string | null {
  const body = raw.trim();
  if (body.length > MAX_INPUT_CHARS) {
    return null;
  }
  let negative = false;
  let digitsBody = body;
  if (digitsBody.startsWith("-")) {
    negative = true;
    digitsBody = digitsBody.slice(1);
  }
  if (!digitsBody || digitsBody === ".") {
    return null;
  }
  if (!/^\d*\.?\d*$/.test(digitsBody)) {
    return null;
  }
  const parts = digitsBody.split(".");
  if (parts.length > 2) {
    return null;
  }
  let intPart = parts[0] || "0";
  let fracPart = parts[1] || "";
  if (!/^\d+$/.test(intPart || "0") && intPart !== "") {
    return null;
  }
  if (fracPart && !/^\d+$/.test(fracPart)) {
    return null;
  }
  intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
  fracPart = fracPart.replace(/0+$/, "");
  if (digitCount(intPart) + digitCount(fracPart) > MAX_TOTAL_DIGITS) {
    return null;
  }
  let value = fracPart ? `${intPart}.${fracPart}` : intPart;
  if (value === "0") {
    negative = false;
  }
  if (negative) {
    value = `-${value}`;
  }
  return PLAIN_DECIMAL_FILTER_RE.test(value) ? value : null;
}

function expandScientificNotation(raw: string): NormalizeListFilterNumberResult {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_INPUT_CHARS) {
    return { ok: false, reason: "invalid" };
  }
  const match = trimmed.match(/^(-?)(?:(\d+)(?:\.(\d*))?|\.(\d+))[eE]([+-]?\d+)$/);
  if (!match) {
    return { ok: false, reason: "invalid" };
  }
  const negative = match[1] === "-";
  const intPart = match[2] || "";
  const fracFromDot = match[3] ?? "";
  const fracOnly = match[4] || "";
  const exponent = parseFiniteExponent(match[5]);
  if (exponent === null) {
    return { ok: false, reason: "invalid" };
  }
  const digits = (intPart + fracFromDot) || fracOnly;
  if (!digits || !/^\d+$/.test(digits)) {
    return { ok: false, reason: "invalid" };
  }
  const decimalPos = intPart.length;
  const newPos = decimalPos + exponent;
  let intDigits: string;
  let fracDigits: string;
  if (newPos <= 0) {
    const leadZeros = -newPos;
    if (leadZeros + digitCount(digits) > MAX_TOTAL_DIGITS) {
      return { ok: false, reason: "invalid" };
    }
    const prefix = safeRepeatZero(leadZeros);
    if (prefix === null) {
      return { ok: false, reason: "invalid" };
    }
    const fracBody = `${prefix}${digits}`.replace(/0+$/, "");
    intDigits = "0";
    fracDigits = fracBody;
  } else {
    if (newPos > MAX_TOTAL_DIGITS + digitCount(digits)) {
      return { ok: false, reason: "invalid" };
    }
    let combined = digits;
    const pad = newPos - combined.length;
    if (pad > MAX_TOTAL_DIGITS) {
      return { ok: false, reason: "invalid" };
    }
    if (pad > 0) {
      const padZeros = safeRepeatZero(pad);
      if (padZeros === null) {
        return { ok: false, reason: "invalid" };
      }
      combined = combined + padZeros;
    }
    intDigits = combined.slice(0, newPos) || "0";
    fracDigits = combined.slice(newPos).replace(/0+$/, "");
  }
  if (digitCount(intDigits) + digitCount(fracDigits) > MAX_TOTAL_DIGITS) {
    return { ok: false, reason: "invalid" };
  }
  let value = fracDigits ? `${intDigits}.${fracDigits}` : intDigits;
  value = value.replace(/^0+(?=\d)/, "") || "0";
  if (value === "0") {
    return { ok: true, value: "0" };
  }
  if (negative) {
    value = `-${value}`;
  }
  if (!PLAIN_DECIMAL_FILTER_RE.test(value)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value };
}

function digitCount(part: string): number {
  return part.replace(/\D/g, "").length;
}
