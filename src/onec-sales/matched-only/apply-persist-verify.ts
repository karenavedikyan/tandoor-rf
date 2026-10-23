import type { PoolClient } from "pg";
import { loadKnownLegalGuidSet } from "./catalog";
import type { MatchedOnlyBundleInput } from "./guards";
import type { BundlePartition } from "./partition";
import type { MatchedOnlyBundlePlanV1 } from "./types";
import type { ExecutionManifestBudgetV2 } from "./production/manifest-types";
import {
  verifyMatchedMaterializedRows,
  verifyPersistedTotalsMatchBudget,
} from "./apply-persist-materialization";
import { validateExecutionBudgetAgainstSource } from "./production/manifest-budget";

export async function verifyMatchedOnlyPersistedOutcome(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  partition: BundlePartition,
  rosters: MatchedOnlyBundleInput,
  inserted: {
    saleAggregate: number;
    saleItems: number;
    returnsAggregate: number;
    returnItems: number;
  },
  executionBudget?: ExecutionManifestBudgetV2 | null,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const expected = {
    saleAggregate: partition.saleAggregate.counts.matched,
    saleItems: partition.saleItems.counts.matched,
    returnsAggregate: partition.returnsAggregate.counts.matched,
    returnItems: partition.returnItems.counts.matched,
  };

  if (
    inserted.saleAggregate !== expected.saleAggregate ||
    inserted.saleItems !== expected.saleItems ||
    inserted.returnsAggregate !== expected.returnsAggregate ||
    inserted.returnItems !== expected.returnItems
  ) {
    return {
      ok: false,
      code: "DML_RETURNING_COUNT_MISMATCH",
      message: "Insert returning counts do not match expected persisted keys.",
    };
  }

  const materialized = await verifyMatchedMaterializedRows(client, plan, partition, rosters);
  if (!materialized.ok) {
    return materialized;
  }

  if (executionBudget) {
    const known = await loadKnownLegalGuidSet(client);
    const sourceBudget = validateExecutionBudgetAgainstSource(plan, executionBudget, rosters, known);
    if (!sourceBudget.ok) {
      return sourceBudget;
    }
    const totals = await verifyPersistedTotalsMatchBudget(client, plan, executionBudget);
    if (!totals.ok) {
      return totals;
    }
  }

  return { ok: true };
}
