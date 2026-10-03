export type HoldingLinkValidationPolicy = "tolerant" | "strict";

/** Production default until parent-card requirement is enforced. */
export const DEFAULT_HOLDING_LINK_VALIDATION_POLICY: HoldingLinkValidationPolicy = "tolerant";

export type HoldingLinkState = "none" | "resolved" | "unresolved";

export function isHoldingLinkValidationPolicy(value: string): value is HoldingLinkValidationPolicy {
  return value === "tolerant" || value === "strict";
}
