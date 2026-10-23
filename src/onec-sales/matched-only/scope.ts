import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "../types";
import type { MatchedOnlyBundlePlanV1 } from "./types";
import { sha256CanonicalJson } from "./canonical-json";

export type RosterBundleInput = {
  saleAggregate: LegalSalesRoster;
  saleItems: LegalSaleItemsRoster;
  returnsAggregate: LegalReturnsRoster;
  returnItems: LegalReturnItemsRoster;
};

export function deriveSaleMonthsIsoFromRosters(rosters: RosterBundleInput): string[] {
  return [
    ...new Set([
      ...rosters.saleAggregate.lines.map((l) => l.saleMonthStartIso),
      ...rosters.saleItems.lines.map((l) => l.saleMonthStartIso),
      ...rosters.returnsAggregate.lines.map((l) => l.saleMonthStartIso),
      ...rosters.returnItems.lines.map((l) => l.saleMonthStartIso),
    ]),
  ].sort();
}

export function derivePeriodsFromRosters(rosters: RosterBundleInput): string[] {
  return [
    ...new Set([
      ...rosters.saleAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...rosters.saleItems.lines.map((l) => l.saleMonthYyyyMm),
      ...rosters.returnsAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...rosters.returnItems.lines.map((l) => l.saleMonthYyyyMm),
    ]),
  ].sort();
}

export function monthIsoToPeriod(monthIso: string): string {
  return monthIso.slice(0, 7);
}

export function computeOperationsDigest(
  sourceHashes: MatchedOnlyBundlePlanV1["sourceHashes"],
  saleMonthsIso: string[],
): string {
  return sha256CanonicalJson({
    v: 1,
    sourceHashes,
    saleMonthsIso: [...saleMonthsIso].sort(),
  });
}

export function assertRosterScopeMatchesApprovedPlan(
  plan: MatchedOnlyBundlePlanV1,
  rosters: RosterBundleInput,
): void {
  const derivedMonths = deriveSaleMonthsIsoFromRosters(rosters);
  const planMonths = [...plan.scope.saleMonthsIso].sort();
  if (derivedMonths.length !== planMonths.length || derivedMonths.some((m, i) => m !== planMonths[i])) {
    throw new Error("PLAN_SCOPE_MISMATCH");
  }
  const derivedPeriods = derivePeriodsFromRosters(rosters);
  const planPeriods = [...plan.periods].sort();
  if (derivedPeriods.length !== planPeriods.length || derivedPeriods.some((p, i) => p !== planPeriods[i])) {
    throw new Error("PLAN_PERIODS_DRIFT");
  }
  for (const monthIso of derivedMonths) {
    if (!planPeriods.includes(monthIsoToPeriod(monthIso))) {
      throw new Error("PLAN_SCOPE_PERIOD_MISMATCH");
    }
  }
  const expectedOps = computeOperationsDigest(plan.sourceHashes, derivedMonths);
  if (expectedOps !== plan.scope.operationsDigest) {
    throw new Error("PLAN_SCOPE_DRIFT");
  }
}
