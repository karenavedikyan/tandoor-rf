import type { ValidateClientsLimits } from "./extended-validate";
import { holdingV2PipelineEnabledEffective } from "./holding-v2-pipeline-config";

/** Explicit v2 contract when pipeline flag is ON — never inferred from self-ref alone. */
export function mergeHoldingV2StableReadLimits(
  base?: ValidateClientsLimits,
): ValidateClientsLimits | undefined {
  if (!holdingV2PipelineEnabledEffective()) {
    return base;
  }
  return {
    ...base,
    holdingExchangeSchema: "v2",
  };
}
