import { DEFAULT_HOLDING_LINK_VALIDATION_POLICY, type HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";

export type RegularUpdateConfig = {
  stabilityDelayMs: number;
  readRetries: number;
  readDeadlineMs: number;
  holdingLinkValidationPolicy: HoldingLinkValidationPolicy;
};

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadRegularUpdateConfig(env: NodeJS.ProcessEnv = process.env): RegularUpdateConfig {
  const policyRaw = env.ONEC_REGULAR_UPDATE_HOLDING_LINK_POLICY?.trim();
  const holdingLinkValidationPolicy =
    policyRaw === "strict" ? "strict" : DEFAULT_HOLDING_LINK_VALIDATION_POLICY;

  return {
    stabilityDelayMs: readPositiveInt(env.ONEC_REGULAR_UPDATE_STABILITY_DELAY_MS, 2000),
    readRetries: readPositiveInt(env.ONEC_REGULAR_UPDATE_READ_RETRIES, 1),
    readDeadlineMs: readPositiveInt(env.ONEC_REGULAR_UPDATE_READ_DEADLINE_MS, 60_000),
    holdingLinkValidationPolicy,
  };
}
