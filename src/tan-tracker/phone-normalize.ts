/** Normalize RU mobile to +7XXXXXXXXXX (12 chars) or null if invalid. */
export function normalizeRuPhoneE164(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("77")) {
    d = d.slice(1);
  }
  if (d.length === 11 && d.startsWith("8")) {
    d = `7${d.slice(1)}`;
  }
  if (d.length === 11 && d.startsWith("7")) {
    return `+${d}`;
  }
  if (d.length === 10) {
    return `+7${d}`;
  }
  return null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** National mobile digits (10) for +7XXXXXXXXXX, or null. */
export function ruPhoneNational10(rawOrE164: string): string | null {
  const e164 = normalizeRuPhoneE164(rawOrE164);
  if (!e164) return null;
  return e164.slice(2);
}
