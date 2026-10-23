import type { MatchedOnlyBundleInput } from "../guards";
import { isKnownGuid, loadKnownLegalGuidSet } from "../catalog";
import type { PoolClient } from "pg";
import { partitionSalesBundle } from "../partition";
import type { DatasetRowCounts, MatchedOnlyBundlePlanV1 } from "../types";
import type { ExecutionManifestBudgetV2 } from "./manifest-types";

export const EXECUTION_QUANTITY_SCALE = 6;

function sumMatchedReturnItemIncome(
  rosters: MatchedOnlyBundleInput,
  known: Set<string>,
): string {
  let total = 0;
  for (const line of rosters.returnItems.lines) {
    if (isKnownGuid(known, line.legalGuid)) {
      total += Number(line.income);
    }
  }
  return total.toFixed(EXECUTION_QUANTITY_SCALE);
}

export function buildExecutionBudgetFromPlan(
  plan: MatchedOnlyBundlePlanV1,
  returnsMatchedIncome: string,
): ExecutionManifestBudgetV2 {
  const dml = (counts: DatasetRowCounts) => counts.matched;
  return {
    quantityScale: EXECUTION_QUANTITY_SCALE,
    operationScopeDigest: plan.scope.operationsDigest,
    beforeStateSha256: plan.beforeStateSha256,
    counts: plan.counts,
    expectedDmlInserts: {
      saleAggregate: dml(plan.counts.saleAggregate),
      saleItems: dml(plan.counts.saleItems),
      returnsAggregate: dml(plan.counts.returnsAggregate),
      returnItems: dml(plan.counts.returnItems),
    },
    returnsMatchedIncome,
  };
}

export async function buildExecutionBudgetFromLivePlan(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  rosters: MatchedOnlyBundleInput,
): Promise<ExecutionManifestBudgetV2> {
  const known = await loadKnownLegalGuidSet(client);
  const partition = partitionSalesBundle({ ...rosters, known });
  const income = sumMatchedReturnItemIncome(rosters, known);
  const budget = buildExecutionBudgetFromPlan(plan, income);
  const dml = budget.expectedDmlInserts;
  if (
    dml.saleAggregate !== partition.saleAggregate.counts.matched ||
    dml.saleItems !== partition.saleItems.counts.matched ||
    dml.returnsAggregate !== partition.returnsAggregate.counts.matched ||
    dml.returnItems !== partition.returnItems.counts.matched
  ) {
    throw new Error("EXECUTION_BUDGET_DML_MISMATCH");
  }
  return budget;
}

export function validateManifestBudgetAgainstPlan(
  plan: MatchedOnlyBundlePlanV1,
  budget: ExecutionManifestBudgetV2 | null | undefined,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!budget) {
    return { ok: false, code: "MANIFEST_BUDGET_MISSING", message: "Execution budget is required." };
  }
  if (budget.quantityScale !== EXECUTION_QUANTITY_SCALE) {
    return {
      ok: false,
      code: "MANIFEST_BUDGET_INVALID",
      message: "Execution budget quantityScale must be 6.",
    };
  }
  if (budget.operationScopeDigest !== plan.scope.operationsDigest) {
    return {
      ok: false,
      code: "MANIFEST_BUDGET_SCOPE_MISMATCH",
      message: "Execution budget scope does not match plan.",
    };
  }
  if (budget.beforeStateSha256 !== plan.beforeStateSha256) {
    return {
      ok: false,
      code: "MANIFEST_BUDGET_BEFORE_MISMATCH",
      message: "Execution budget before-state does not match plan.",
    };
  }
  const datasets = ["saleAggregate", "saleItems", "returnsAggregate", "returnItems"] as const;
  for (const key of datasets) {
    const planCounts = plan.counts[key];
    const budgetCounts = budget.counts[key];
    if (
      planCounts.full !== budgetCounts.full ||
      planCounts.matched !== budgetCounts.matched ||
      planCounts.excluded !== budgetCounts.excluded
    ) {
      return {
        ok: false,
        code: "MANIFEST_BUDGET_COUNTS_MISMATCH",
        message: `Execution budget counts mismatch for ${key}.`,
      };
    }
    if (budget.expectedDmlInserts[key] !== planCounts.matched) {
      return {
        ok: false,
        code: "MANIFEST_BUDGET_DML_MISMATCH",
        message: `Execution budget DML insert expectation mismatch for ${key}.`,
      };
    }
  }
  return { ok: true };
}
