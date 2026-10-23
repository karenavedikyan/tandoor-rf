import type { PoolClient } from "pg";
import { resolveTargetDbIdentityFromUrl } from "../../onec-exchange-v3/target-db-identity";
import { analyzeSalesBundle, isBundleParityOk } from "../bundle-analyze";
import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "../types";
import { backupSha256 } from "./backup";
import {
  computeCatalogFingerprint,
  computeUnknownUnionDigest,
  loadKnownLegalGuidSet,
} from "./catalog";
import { partitionSalesBundle } from "./partition";
import { planHashFromPlan } from "./plan-build";
import { businessDigestFromScopedTables, captureScopedBeforeState, operationsDigest } from "./state-digest";
import type { DatasetRowCounts, MatchedOnlyBundlePlanV1, MatchedOnlyScopedBackupV1 } from "./types";

export type MatchedOnlyBundleInput = {
  saleAggregate: LegalSalesRoster;
  saleItems: LegalSaleItemsRoster;
  returnsAggregate: LegalReturnsRoster;
  returnItems: LegalReturnItemsRoster;
};

export type GuardFailure = { code: string; message: string };

export async function assertLiveTargetMatchesPlan(
  databaseUrl: string,
  plan: MatchedOnlyBundlePlanV1,
): Promise<void> {
  const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
  if (identity.fingerprint !== plan.identity.targetDbFingerprint) {
    throw new Error("TARGET_IDENTITY_MISMATCH");
  }
}

function countsEqual(a: DatasetRowCounts, b: DatasetRowCounts): boolean {
  return a.full === b.full && a.matched === b.matched && a.excluded === b.excluded;
}

export function validateBackupAgainstPlan(
  backup: MatchedOnlyScopedBackupV1,
  plan: MatchedOnlyBundlePlanV1,
  expectedBackupSha256: string,
): GuardFailure | null {
  const computedPlanHash = planHashFromPlan(plan);
  if (backup.planHash !== computedPlanHash) {
    return { code: "BACKUP_PLAN_HASH_MISMATCH", message: "Backup planHash does not match plan document." };
  }
  if (backup.targetDbFingerprint !== plan.identity.targetDbFingerprint) {
    return { code: "BACKUP_TARGET_MISMATCH", message: "Backup target DB fingerprint mismatch." };
  }
  const planMonths = [...plan.scope.saleMonthsIso].sort();
  const backupMonths = [...backup.saleMonthsIso].sort();
  if (planMonths.length !== backupMonths.length || planMonths.some((m, i) => m !== backupMonths[i])) {
    return { code: "BACKUP_SCOPE_MISMATCH", message: "Backup month scope must exactly equal plan scope." };
  }
  const tablesDigest = businessDigestFromScopedTables({
    saleMonthsIso: backupMonths,
    tables: backup.tables,
  });
  if (tablesDigest !== plan.beforeStateSha256) {
    return { code: "BACKUP_TABLES_DIGEST_MISMATCH", message: "Backup tables digest does not match plan before-state." };
  }
  if (backup.beforeStateSha256 !== plan.beforeStateSha256) {
    return { code: "BACKUP_BEFORE_STATE_MISMATCH", message: "Backup before-state metadata mismatch." };
  }
  const sha = backupSha256(backup);
  if (expectedBackupSha256 !== sha) {
    return { code: "BACKUP_SHA_MISMATCH", message: "Backup SHA-256 does not match expected sealed value." };
  }
  for (const key of Object.keys(plan.sourceHashes) as (keyof typeof plan.sourceHashes)[]) {
    if (backup.sourceHashes[key] !== plan.sourceHashes[key]) {
      return { code: "BACKUP_SOURCE_SHA_MISMATCH", message: `Backup source SHA mismatch for ${key}.` };
    }
  }
  return null;
}

export async function validateApprovedPlanAgainstLive(
  client: PoolClient,
  plan: MatchedOnlyBundlePlanV1,
  rosters: MatchedOnlyBundleInput,
): Promise<void> {
  const hashes = plan.sourceHashes;
  if (hashes.saleAggregate !== rosters.saleAggregate.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }
  if (hashes.saleItems !== rosters.saleItems.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }
  if (hashes.returnsAggregate !== rosters.returnsAggregate.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }
  if (hashes.returnItems !== rosters.returnItems.sourceSha256) {
    throw new Error("PLAN_SOURCE_SHA_MISMATCH");
  }

  const known = await loadKnownLegalGuidSet(client);
  const catalogFingerprint = computeCatalogFingerprint(known);
  if (catalogFingerprint !== plan.catalog.fingerprint) {
    throw new Error("PLAN_CATALOG_DRIFT");
  }

  const partition = partitionSalesBundle({
    saleAggregate: rosters.saleAggregate,
    saleItems: rosters.saleItems,
    returnsAggregate: rosters.returnsAggregate,
    returnItems: rosters.returnItems,
    known,
  });
  const unknownDigest = computeUnknownUnionDigest(partition.unknownGuids);
  if (unknownDigest !== plan.catalog.unknownUnionDigest) {
    throw new Error("PLAN_UNKNOWN_UNION_DRIFT");
  }
  if (partition.unknownGuids.length !== plan.catalog.unknownUnionCount) {
    throw new Error("PLAN_UNKNOWN_UNION_DRIFT");
  }

  if (
    !countsEqual(partition.saleAggregate.counts, plan.counts.saleAggregate) ||
    !countsEqual(partition.saleItems.counts, plan.counts.saleItems) ||
    !countsEqual(partition.returnsAggregate.counts, plan.counts.returnsAggregate) ||
    !countsEqual(partition.returnItems.counts, plan.counts.returnItems)
  ) {
    throw new Error("PLAN_COUNTS_DRIFT");
  }

  const periods = [
    ...new Set([
      ...rosters.saleAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...rosters.saleItems.lines.map((l) => l.saleMonthYyyyMm),
      ...rosters.returnsAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...rosters.returnItems.lines.map((l) => l.saleMonthYyyyMm),
    ]),
  ].sort();
  const planPeriods = [...plan.periods].sort();
  if (periods.length !== planPeriods.length || periods.some((p, i) => p !== planPeriods[i])) {
    throw new Error("PLAN_PERIODS_DRIFT");
  }

  const opsDigest = operationsDigest(plan);
  if (opsDigest !== plan.scope.operationsDigest) {
    throw new Error("PLAN_SCOPE_DRIFT");
  }

  const report = analyzeSalesBundle({
    salesAggregate: rosters.saleAggregate,
    salesItems: rosters.saleItems,
    returnsAggregate: rosters.returnsAggregate,
    returnsItems: rosters.returnItems,
    knownCatalogLegalGuids: known,
  });
  const salesParityOk =
    report.parity.onlyAggregate === 0 &&
    report.parity.onlyItems === 0 &&
    report.parity.metricMismatches === 0;
  const returnsParityOk = report.returnsParity.parityOk;
  if (salesParityOk !== plan.parity.salesParityOk || returnsParityOk !== plan.parity.returnsParityOk) {
    throw new Error("PLAN_PARITY_DRIFT");
  }
  if (!isBundleParityOk(report)) {
    throw new Error("BUNDLE_PARITY_FAILED");
  }

  const before = await captureScopedBeforeState(client, plan.scope.saleMonthsIso);
  if (before.businessDigest !== plan.beforeStateSha256) {
    throw new Error("PLAN_BEFORE_STATE_DRIFT");
  }
}

export function assertBackupCaptureMatchesPlan(
  backup: MatchedOnlyScopedBackupV1,
  plan: MatchedOnlyBundlePlanV1,
): void {
  const failure = validateBackupAgainstPlan(backup, plan, backupSha256(backup));
  if (failure) {
    throw new Error(failure.code);
  }
}
