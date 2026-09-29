export function parseCanonicalBitrixId(value: unknown): string | null {
  if (typeof value === "boolean") {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      return null;
    }
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }
  return null;
}

export function parseBitrixUserId(raw: string): string | null {
  return parseCanonicalBitrixId(raw);
}
