export type DecimalParseResult =
  | { ok: true; numeric: string; raw: string }
  | { ok: false; raw: string };

/** Parse 1C decimal with comma separator without float rounding. */
export function parseCatalogDecimal(raw: string): DecimalParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, raw };
  }
  if (!/^-?\d+(,\d+)?$/.test(trimmed)) {
    return { ok: false, raw };
  }
  const normalized = trimmed.replace(",", ".");
  return { ok: true, numeric: normalized, raw: trimmed };
}
