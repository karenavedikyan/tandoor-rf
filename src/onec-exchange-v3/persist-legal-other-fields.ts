import { stampOtherFieldsBagComplete } from "./other-fields-presence";
import type { V3ClientOtherFields } from "./other-fields";

/** Trusted server-side stamp for persisted legal `other_fields` (never from exchange JSON). */
export function persistableLegalOtherFields(
  otherFields: V3ClientOtherFields | Record<string, unknown>,
  clientsSourceSha256: string,
): Record<string, unknown> {
  return stampOtherFieldsBagComplete(otherFields as Record<string, unknown>, clientsSourceSha256);
}
