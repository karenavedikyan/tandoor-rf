/** Decimal string accepted by parseV3FilterRulesParam for number fields. */
export function normalizeListFilterNumberValue(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: "empty" | "invalid" } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || trimmed === "-") {
    return { ok: false, reason: "empty" };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "invalid" };
  }
  let value = String(n);
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return { ok: true, value };
  }
  if (Number.isInteger(n)) {
    return { ok: true, value: String(n) };
  }
  value = n.toFixed(12).replace(/\.?0+$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value };
}
