/** When false (default), v2 payloads remain APPLY_BLOCKED at import apply. */
export function isHoldingV2PipelineEnabled(): boolean {
  const raw = process.env.ONEC_HOLDING_V2_PIPELINE_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Test-only override (does not persist; resets when unset). */
let testOverride: boolean | undefined;

export function setHoldingV2PipelineEnabledForTests(enabled: boolean | undefined): void {
  testOverride = enabled;
}

export function holdingV2PipelineEnabledEffective(): boolean {
  if (testOverride !== undefined) {
    return testOverride;
  }
  return isHoldingV2PipelineEnabled();
}
