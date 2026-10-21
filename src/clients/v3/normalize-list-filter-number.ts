/** Matches parseV3FilterRulesParam number validation in list-field-rules.ts */
export const PLAIN_DECIMAL_FILTER_RE = /^-?\d+(\.\d+)?$/;

const MAX_TOTAL_DIGITS = 40;

export type NormalizeListFilterNumberResult =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "invalid" };

export function normalizeListFilterNumberValue(raw: string): NormalizeListFilterNumberResult {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || trimmed === "-") {
    return { ok: false, reason: "empty" };
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

function canonicalizePlainDecimal(raw: string): string | null {
  let body = raw.trim();
  let negative = false;
  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1);
  }
  if (!body || body === ".") {
    return null;
  }
  if (!/^\d*\.?\d*$/.test(body)) {
    return null;
  }
  const parts = body.split(".");
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
  const match = raw
    .trim()
    .match(/^(-?)(?:(\d+)(?:\.(\d*))?|\.(\d+))[eE]([+-]?\d+)$/);
  if (!match) {
    return { ok: false, reason: "invalid" };
  }
  const negative = match[1] === "-";
  const intPart = match[2] || "";
  const fracFromDot = match[3] ?? "";
  const fracOnly = match[4] || "";
  const exponent = Number(match[5]);
  if (!Number.isInteger(exponent)) {
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
    const fracBody = `${"0".repeat(-newPos)}${digits}`.replace(/0+$/, "");
    intDigits = "0";
    fracDigits = fracBody;
  } else {
    let combined = digits;
    if (newPos > combined.length) {
      combined = combined + "0".repeat(newPos - combined.length);
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
