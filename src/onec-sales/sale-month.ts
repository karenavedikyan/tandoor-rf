import { parseCalendarDateInput } from "../shared/calendar-date";

export type SaleMonthParseResult =
  | { ok: true; yyyyMm: string; monthStartIso: string }
  | { ok: false; code: "INVALID_TYPE" | "INVALID_MONTH" | "EMPTY" };

/** Normalize sale month to YYYY-MM (calendar month, no timezone shift). */
export function normalizeSaleMonth(value: unknown): SaleMonthParseResult {
  if (value === null || value === undefined) {
    return { ok: false, code: "EMPTY" };
  }
  if (typeof value !== "string") {
    return { ok: false, code: "INVALID_TYPE" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "EMPTY" };
  }
  const yyyyMmOnly = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (yyyyMmOnly) {
    const year = Number(yyyyMmOnly[1]);
    const month = Number(yyyyMmOnly[2]);
    if (month < 1 || month > 12) {
      return { ok: false, code: "INVALID_MONTH" };
    }
    const monthStartIso = `${yyyyMmOnly[1]}-${yyyyMmOnly[2]}-01`;
    return { ok: true, yyyyMm: `${yyyyMmOnly[1]}-${yyyyMmOnly[2]}`, monthStartIso };
  }
  const parsed = parseCalendarDateInput(trimmed);
  if (!parsed.ok) {
    return { ok: false, code: "INVALID_MONTH" };
  }
  const yyyyMm = parsed.isoDate.slice(0, 7);
  return { ok: true, yyyyMm, monthStartIso: `${yyyyMm}-01` };
}
