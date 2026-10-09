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
  if (beforeHash === afterHash) {
    return false;
  }

  const state = await client.query<{ last_normalized_state_sha256: string | null }>(
    `SELECT last_normalized_state_sha256 FROM onec_holding_v2_apply_state WHERE id = 1`,
  );
  const last = state.rows[0]?.last_normalized_state_sha256 ?? null;
  if (!last) {
    return true;
  }
  return last.toLowerCase() !== afterHash.toLowerCase();
}
