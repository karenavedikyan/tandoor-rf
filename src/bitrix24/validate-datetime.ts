export type ParsedOptionalDate =
  | { kind: "absent" }
  | { kind: "valid"; value: string }
  | { kind: "invalid" };

export function parseOptionalBitrixDate(value: unknown): ParsedOptionalDate {
  if (value === null || value === undefined) {
    return { kind: "absent" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "absent" };
  }
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) {
    return { kind: "invalid" };
  }
  return { kind: "valid", value: trimmed };
}
