import { saleDecimalStringsEqual } from "../../decimal";
import { saleQuantityStringsExactEqual } from "../../decimal-sum";
import type { MatchedOnlyBundleInput } from "../guards";
import { partitionSalesBundle } from "../partition";
import type { DatasetRowCounts, MatchedOnlyBundlePlanV1 } from "../types";
import { buildFinancialTotalsFromPartition, buildMatchedTotalsFromPartition } from "../apply-persist-materialization";
import type { ExecutionManifestBudgetV2 } from "./manifest-types";

export const EXECUTION_QUANTITY_SCALE = 6;

export function matchedTotalsEqual(
  a: ExecutionManifestBudgetV2["matchedTotals"],
  b: ExecutionManifestBudgetV2["matchedTotals"],
): boolean {
  const datasets = ["saleAggregate", "saleItems", "returnsAggregate", "returnItems"] as const;
  for (const key of datasets) {
    const left = a[key];
    const right = b[key];
    if (
      !saleDecimalStringsEqual(left.matchedIncome, right.matchedIncome) ||
      !saleQuantityStringsExactEqual(left.matchedQuantity, right.matchedQuantity)
    ) {
      return false;
    }
    if (key === "saleItems") {
      const l = left as ExecutionManifestBudgetV2["matchedTotals"]["saleItems"];
      const r = right as ExecutionManifestBudgetV2["matchedTotals"]["saleItems"];
      if (!saleDecimalStringsEqual(l.matchedCostPrice, r.matchedCostPrice)) {
        return false;
      }
    }
  }
  return true;
}

export function buildExecutionBudgetFromPartition(
  plan: MatchedOnlyBundlePlanV1,
  partition: ReturnType<typeof partitionSalesBundle>,
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
    financialTotals: buildFinancialTotalsFromPartition(partition),
    matchedTotals: buildMatchedTotalsFromPartition(partition),
  };
}

function financialTotalsEqual(
  a: ExecutionManifestBudgetV2["financialTotals"],
  b: ExecutionManifestBudgetV2["financialTotals"],
): boolean {
  const datasets = ["saleAggregate", "saleItems", "returnsAggregate", "returnItems"] as const;
  for (const key of datasets) {
    for (const bucket of ["full", "matched", "excluded"] as const) {
      const left = a[key][bucket];
      const right = b[key][bucket];
      if (
        !saleDecimalStringsEqual(left.income, right.income) ||
        !saleQuantityStringsExactEqual(left.quantity, right.quantity)
      ) {
        return false;
      }
      if (key === "saleItems") {
        const l = left as ExecutionManifestBudgetV2["financialTotals"]["saleItems"]["full"];
        const r = right as ExecutionManifestBudgetV2["financialTotals"]["saleItems"]["full"];
        if (!saleDecimalStringsEqual(l.costPrice, r.costPrice)) {
          return false;
        }
      }
    }
  }
  return true;
}

export function buildExecutionBudgetFromRosters(
  plan: MatchedOnlyBundlePlanV1,
  rosters: MatchedOnlyBundleInput,
  known: Set<string>,
): ExecutionManifestBudgetV2 {
  const partition = partitionSalesBundle({ ...rosters, known });
  return buildExecutionBudgetFromPartition(plan, partition);
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

export function validateExecutionBudgetAgainstSource(
  plan: MatchedOnlyBundlePlanV1,
  budget: ExecutionManifestBudgetV2,
  rosters: MatchedOnlyBundleInput,
  known: Set<string>,
): { ok: true } | { ok: false; code: string; message: string } {
  const planCheck = validateManifestBudgetAgainstPlan(plan, budget);
  if (!planCheck.ok) {
    return planCheck;
  }
  const fromSource = buildExecutionBudgetFromRosters(plan, rosters, known);
  if (!matchedTotalsEqual(fromSource.matchedTotals, budget.matchedTotals)) {
    return {
      ok: false,
      code: "MANIFEST_BUDGET_SOURCE_MISMATCH",
      message: "Execution budget monetary totals do not match source-derived plan.",
    };
  }
  if (!financialTotalsEqual(fromSource.financialTotals, budget.financialTotals)) {
    return {
      ok: false,
      code: "MANIFEST_BUDGET_SOURCE_MISMATCH",
      message: "Execution budget full/matched/excluded totals do not match source.",
    };
  }
  return { ok: true };
}
