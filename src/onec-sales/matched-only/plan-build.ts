import type { PoolClient } from "pg";
import { analyzeSalesBundle, isBundleParityOk } from "../bundle-analyze";
import type {
  LegalReturnItemsRoster,
  LegalReturnsRoster,
  LegalSaleItemsRoster,
  LegalSalesRoster,
} from "../types";
import {
  computeCatalogFingerprint,
  computeUnknownUnionDigest,
  loadKnownLegalGuidSet,
} from "./catalog";
import { sha256CanonicalJson } from "./canonical-json";
import { partitionSalesBundle } from "./partition";
import { computeOperationsDigest, deriveSaleMonthsIsoFromRosters } from "./scope";
import { captureScopedBeforeState } from "./state-digest";
import type { MatchedOnlyBundlePlanV1 } from "./types";

export function planHashFromPlan(plan: MatchedOnlyBundlePlanV1): string {
  return sha256CanonicalJson(plan);
}

export type BuildMatchedOnlyBundlePlanOptions = {
  /**
   * When set (one-shot 047–048 path only), skips scoped before-state capture so no 049 sidecar tables are queried.
   * Must be the native 047–048 digest already verified under import lock.
   */
  trustedBeforeStateSha256?: string;
};

export async function buildMatchedOnlyBundlePlan(
  client: PoolClient,
  input: {
    saleAggregate: LegalSalesRoster;
    saleItems: LegalSaleItemsRoster;
    returnsAggregate: LegalReturnsRoster;
    returnItems: LegalReturnItemsRoster;
    targetDbFingerprint: string;
  },
  options?: BuildMatchedOnlyBundlePlanOptions,
): Promise<{ plan: MatchedOnlyBundlePlanV1; planHash: string; report: ReturnType<typeof analyzeSalesBundle> }> {
  const known = await loadKnownLegalGuidSet(client);
  const report = analyzeSalesBundle({
    salesAggregate: input.saleAggregate,
    salesItems: input.saleItems,
    returnsAggregate: input.returnsAggregate,
    returnsItems: input.returnItems,
    knownCatalogLegalGuids: known,
  });
  if (!isBundleParityOk(report)) {
    throw new Error("BUNDLE_PARITY_FAILED");
  }
  const partition = partitionSalesBundle({
    saleAggregate: input.saleAggregate,
    saleItems: input.saleItems,
    returnsAggregate: input.returnsAggregate,
    returnItems: input.returnItems,
    known,
  });

  const saleMonthsIso = deriveSaleMonthsIsoFromRosters({
    saleAggregate: input.saleAggregate,
    saleItems: input.saleItems,
    returnsAggregate: input.returnsAggregate,
    returnItems: input.returnItems,
  });

  const periods = [
    ...new Set([
      ...input.saleAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...input.saleItems.lines.map((l) => l.saleMonthYyyyMm),
      ...input.returnsAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...input.returnItems.lines.map((l) => l.saleMonthYyyyMm),
    ]),
  ].sort();

  const trustedBefore = options?.trustedBeforeStateSha256?.trim();
  const beforeStateSha256 = trustedBefore
    ? trustedBefore
    : (await captureScopedBeforeState(client, saleMonthsIso)).businessDigest;

  const sourceHashes = {
    saleAggregate: input.saleAggregate.sourceSha256,
    saleItems: input.saleItems.sourceSha256,
    returnsAggregate: input.returnsAggregate.sourceSha256,
    returnItems: input.returnItems.sourceSha256,
  };
  const scope = {
    saleMonthsIso,
    operationsDigest: computeOperationsDigest(sourceHashes, saleMonthsIso),
  };

  const plan: MatchedOnlyBundlePlanV1 = {
    v: 1,
    policy: "matched-only",
    sourceHashes,
    periods,
    parity: {
      salesParityOk:
        report.parity.onlyAggregate === 0 &&
        report.parity.onlyItems === 0 &&
        report.parity.metricMismatches === 0,
      returnsParityOk: report.returnsParity.parityOk,
    },
    identity: {
      targetDbFingerprint: input.targetDbFingerprint,
    },
    catalog: {
      fingerprint: computeCatalogFingerprint(known),
      knownLegalEntityCount: known.size,
      unknownUnionDigest: computeUnknownUnionDigest(partition.unknownGuids),
      unknownUnionCount: partition.unknownGuids.length,
    },
    counts: {
      saleAggregate: partition.saleAggregate.counts,
      saleItems: partition.saleItems.counts,
      returnsAggregate: partition.returnsAggregate.counts,
      returnItems: partition.returnItems.counts,
    },
    scope,
    beforeStateSha256,
  };
  return { plan, planHash: planHashFromPlan(plan), report };
}

export function assertPlanParityOk(report: ReturnType<typeof analyzeSalesBundle>): void {
  if (!isBundleParityOk(report)) {
    throw new Error("BUNDLE_PARITY_FAILED");
  }
}
