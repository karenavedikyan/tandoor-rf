function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Per-record extended markers per confirmed 1C contract (02.10.2026). */
export function isExtendedClientRecord(raw: unknown): boolean {
  if (!isPlainObject(raw)) {
    return false;
  }
  if (typeof raw.holding === "boolean") {
    return true;
  }
  if (Array.isArray(raw.retail_outlets)) {
    return true;
  }
  return false;
}

export function detectClientsSourceFormat(parsed: unknown[]): "legacy" | "extended_v1" {
  for (const row of parsed) {
    if (isExtendedClientRecord(row)) {
      return "extended_v1";
    }
  }
  return "legacy";
}
