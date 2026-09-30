import { parseOptionalBitrixDate } from "./validate-datetime";

export function bitrixChangedAtToDate(value: string | null | undefined): Date | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const parsed = parseOptionalBitrixDate(value);
  if (parsed.kind !== "valid") {
    return null;
  }
  const instant = Date.parse(parsed.value);
  if (!Number.isFinite(instant)) {
    return null;
  }
  return new Date(instant);
}
