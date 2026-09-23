const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const NULL_UUID = "00000000-0000-0000-0000-000000000000";

export function normalizeUuid(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidNonZeroUuid(value: string): boolean {
  const normalized = normalizeUuid(value);
  if (normalized === NULL_UUID) {
    return false;
  }
  return UUID_PATTERN.test(normalized);
}

export function isEmptyOrValidNonZeroUuid(value: string): boolean {
  if (value.trim().length === 0) {
    return true;
  }
  return isValidNonZeroUuid(value);
}
