/** Normalize RU mobile to +7XXXXXXXXXX or null if invalid. */
export function normalizeRuPhoneE164(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let ten = digits;
  if (ten.length === 11 && (ten.startsWith("7") || ten.startsWith("8"))) {
    ten = ten.slice(1);
  }
  if (ten.length !== 10) return null;
  return `+7${ten}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
