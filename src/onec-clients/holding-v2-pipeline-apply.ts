import type { PoolClient } from "pg";
import { buildHoldingV2DesiredSnapshot } from "./holding-v2-reconcile/desired-state";
import {
  HoldingV2ReconcilePipelineError,
  runHoldingV2ReconcileOnClient,
} from "./holding-v2-reconcile/apply-internals";
import { validateOutletCompositionForReconcile } from "./holding-v2-reconcile/reconcile-validation";
import { validateTypeCategoryPatches } from "./holding-v2-reconcile/type-category-merge";
import type { HoldingV2ReconcileApplyResult } from "./holding-v2-reconcile/types";
import type { ValidatedClientsPayload } from "./types";

/** Caller must already hold HOLDING_V2_RECONCILE_ADVISORY_LOCK for the import transaction. */
export async function runHoldingV2PipelineInImportTransaction(
  client: PoolClient,
  payload: ValidatedClientsPayload,
  verificationFingerprint: string,
): Promise<Extract<HoldingV2ReconcileApplyResult, { ok: true }>> {
  if (payload.holdingExchangeSchema !== "v2") {
    throw new Error("runHoldingV2PipelineInImportTransaction requires v2 schema payload.");
  }

  const built = buildHoldingV2DesiredSnapshot(payload);
  if (!built.ok) {
    throw new HoldingV2ReconcilePipelineError({
      ok: false,
      code: "INVALID_PAYLOAD",
      message: built.message,
    });
  }
  const desired = built.desired;

  const nullPatch = validateTypeCategoryPatches(desired.typeCategoryPatches);
  if (nullPatch) {
    throw new HoldingV2ReconcilePipelineError({
      ok: false,
      code: nullPatch,
      message: "Explicit null in type_category field is not allowed for reconciliation.",
    });
  }

  const outletIssue = validateOutletCompositionForReconcile(desired);
  if (outletIssue) {
    throw new HoldingV2ReconcilePipelineError({
      ok: false,
      code: outletIssue,
      message: "Retail outlet composition is incomplete for reconciliation (guid_store required).",
    });
  }

  return runHoldingV2ReconcileOnClient(client, desired, {
    verificationFingerprint,
  });
}
