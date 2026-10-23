import type { PoolClient } from "pg";
import type { MatchedOnlyBundlePlanV1, MatchedOnlyScopedBackupV1 } from "./types";
import { captureScopedBeforeState } from "./state-digest";
import { planHashFromPlan } from "./plan-build";

export async function captureScopedBackup(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
): Promise<MatchedOnlyScopedBackupV1> {
  const scoped = await captureScopedBeforeState(client, plan.scope.saleMonthsIso);
  return {
    v: 1,
    planHash: planHashFromPlan(plan),
    targetDbFingerprint: plan.identity.targetDbFingerprint,
    beforeStateSha256: plan.beforeStateSha256,
    capturedAt: new Date().toISOString(),
    saleMonthsIso: plan.scope.saleMonthsIso,
    sourceHashes: plan.sourceHashes,
    tables: {
      saleAggregateLines: scoped.payload.saleAggregateLines as unknown[],
      saleItemLines: scoped.payload.saleItemLines as unknown[],
      returnLines: scoped.payload.returnLines as unknown[],
      returnItemLines: scoped.payload.returnItemLines as unknown[],
      importStates: scoped.payload.importStates as unknown[],
      monthActivations: scoped.payload.monthActivations as unknown[],
      monthStats: scoped.payload.monthStats as unknown[],
      quarantineRows: scoped.payload.quarantineRows as unknown[],
      applyRuns: scoped.payload.applyRuns as unknown[],
    },
  };
}
