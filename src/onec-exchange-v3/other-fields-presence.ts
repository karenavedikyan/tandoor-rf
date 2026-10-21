/** Internal marker written by narrow other_fields backfill apply (not from 1С exchange). */
export const V3_EXCHANGE_OTHER_COMPLETE_MARKER = "__v3ExchangeOtherComplete";

export function otherFieldsBagCompleteForSource(
  other: Record<string, unknown> | null | undefined,
  lastSourceSha256: string | null | undefined,
): boolean {
  if (!other || typeof other !== "object" || !lastSourceSha256) {
    return false;
  }
  const marker = other[V3_EXCHANGE_OTHER_COMPLETE_MARKER];
  return typeof marker === "string" && marker.toLowerCase() === lastSourceSha256.toLowerCase();
}

export function stampOtherFieldsBagComplete(
  other: Record<string, unknown>,
  sourceSha256: string,
): Record<string, unknown> {
  return { ...other, [V3_EXCHANGE_OTHER_COMPLETE_MARKER]: sourceSha256.toLowerCase() };
}
