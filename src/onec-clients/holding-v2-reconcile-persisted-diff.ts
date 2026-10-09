import type { PoolClient } from "pg";
import { holdingV2PipelineEnabledEffective } from "./holding-v2-pipeline-config";
import { buildHoldingV2DesiredSnapshot } from "./holding-v2-reconcile/desired-state";
import { computeBusinessStateSha256 } from "./holding-v2-reconcile/normalized-state";
import { projectHoldingV2BusinessState } from "./holding-v2-reconcile/projected-state";
import { loadHoldingV2PersistedState } from "./holding-v2-reconcile/repository";
import type { ValidatedClientsPayload } from "./types";

/** True when v2 reconcile/backfill is needed despite unchanged clients file SHA / verification fingerprint. */
export async function holdingV2ReconcileIncomingDiffersFromStored(
  client: PoolClient,
  payload: ValidatedClientsPayload,
): Promise<boolean> {
  if (payload.holdingExchangeSchema !== "v2") {
    return false;
  }
  if (!holdingV2PipelineEnabledEffective()) {
    return false;
  }

  const built = buildHoldingV2DesiredSnapshot(payload);
  if (!built.ok) {
    return true;
  }

  const persisted = await loadHoldingV2PersistedState(client);
  const projected = projectHoldingV2BusinessState(persisted, built.desired);
  const beforeHash = computeBusinessStateSha256(persisted);
  const afterHash = computeBusinessStateSha256(projected);
  // Compare actual persisted link/metadata tables to desired projection only.
  // apply_state.last_normalized_state_sha256 can lag after manual drift or partial failure.
  return beforeHash !== afterHash;
}
