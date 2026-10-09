import type { ParsedExtendedClientRecord, ParsedRetailOutlet } from "./extended-types";
import type { ExtendedValidationIssue } from "./extended-types";
import {
  analyzeOutletsForHoldingComposition,
  classifyHoldingCompositionSiteType,
  type HoldingCompositionSiteType,
} from "./holding-v2-composition";
import {
  emptyCompositionDistribution,
  type HoldingV2DiagnosticsSummary,
} from "./holding-v2-diagnostics";
import { outletDuplicateRowsEquivalent } from "./outlet-identity";
import { normalizeUuid } from "./uuid";

export type HoldingExchangeSchema = "legacy" | "v2";

export type IndexedClientRecord = {
  record: ParsedExtendedClientRecord;
  sourceIndex: number;
};

export type HoldingV2ValidationResult = {
  compositionByHolding: Map<string, HoldingCompositionSiteType>;
  diagnostics: HoldingV2DiagnosticsSummary;
};

function pushIssue(
  issues: ExtendedValidationIssue[],
  issue: ExtendedValidationIssue,
  issueCount: { value: number },
): void {
  issues.push(issue);
  issueCount.value += 1;
}

export function isHoldingV2HeadRecord(record: ParsedExtendedClientRecord): boolean {
  if (!record.guid_holding) {
    return false;
  }
  return normalizeUuid(record.guid_client) === normalizeUuid(record.guid_holding);
}

export function validateOutletGuidsForHoldingV2(
  indexedRecords: IndexedClientRecord[],
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): { duplicateOutletGuidCount: number; outletParentLinkConflicts: number } {
  type Occurrence = {
    clientGuid: string;
    sourceIndex: number;
    outletIndex: number;
    outlet: ParsedRetailOutlet;
  };
  const seen = new Map<string, Occurrence>();
  let duplicateOutletGuidCount = 0;
  let outletParentLinkConflicts = 0;

  for (const { record, sourceIndex } of indexedRecords) {
    for (let outletIndex = 0; outletIndex < record.retailOutlets.length; outletIndex += 1) {
      const outlet = record.retailOutlets[outletIndex]!;
      if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
        continue;
      }
      const key = outlet.guidStore.toLowerCase();
      const previous = seen.get(key);
      if (!previous) {
        seen.set(key, {
          clientGuid: record.guid_client,
          sourceIndex,
          outletIndex,
          outlet,
        });
        continue;
      }

      if (previous.clientGuid !== record.guid_client) {
        pushIssue(
          issues,
          {
            code: "OUTLET_GUID_CONFLICT",
            field: "retail_outlets.guid_store",
            index: sourceIndex,
            outletIndex,
          },
          issueCount,
        );
        outletParentLinkConflicts += 1;
        continue;
      }

      if (outletDuplicateRowsEquivalent(previous.outlet, outlet)) {
        duplicateOutletGuidCount += 1;
        pushIssue(
          issues,
          {
            code: "DUPLICATE_OUTLET_GUID",
            field: "retail_outlets.guid_store",
            index: sourceIndex,
            outletIndex,
          },
          issueCount,
        );
        continue;
      }

      const previousClosed = previous.outlet.closureStatus;
      const nextClosed = outlet.closureStatus;
      if (
        (previousClosed === "open" || previousClosed === "closed") &&
        (nextClosed === "open" || nextClosed === "closed") &&
        previous.outlet.closed !== outlet.closed
      ) {
        pushIssue(
          issues,
          {
            code: "OUTLET_GUID_CONFLICT",
            field: "retail_outlets.closed",
            index: sourceIndex,
            outletIndex,
          },
          issueCount,
        );
        continue;
      }

      duplicateOutletGuidCount += 1;
      pushIssue(
        issues,
        {
          code: "DUPLICATE_OUTLET_GUID",
          field: "retail_outlets.guid_store",
          index: sourceIndex,
          outletIndex,
        },
        issueCount,
      );
    }
  }

  return { duplicateOutletGuidCount, outletParentLinkConflicts };
}

export function validateHoldingV2Structure(
  indexedRecords: IndexedClientRecord[],
  rawRecords: unknown[],
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): HoldingV2ValidationResult {
  const compositionByHolding = new Map<string, HoldingCompositionSiteType>();
  const distribution = emptyCompositionDistribution();
  const records = indexedRecords.map((r) => r.record);
  const byGuid = new Map(records.map((r) => [normalizeUuid(r.guid_client), r]));
  const clusterErrors = new Set<string>();
  const sourceIndexByRecord = new Map(records.map((r, i) => [r, indexedRecords[i]!.sourceIndex]));

  for (const { record, sourceIndex } of indexedRecords) {
    if (record.guid_holding && record.guid_holding.trim().length > 0) {
      const visited = new Set<string>();
      let cursor: string | null = normalizeUuid(record.guid_holding);
      while (cursor) {
        if (visited.has(cursor)) {
          pushIssue(
            issues,
            { code: "HOLDING_V2_CYCLE", field: "guid_holding", index: sourceIndex },
            issueCount,
          );
          clusterErrors.add(cursor);
          break;
        }
        visited.add(cursor);
        const node = byGuid.get(cursor);
        if (!node) {
          break;
        }
        if (normalizeUuid(node.guid_client) === normalizeUuid(node.guid_holding ?? "")) {
          break;
        }
        if (!node.guid_holding?.trim()) {
          break;
        }
        cursor = normalizeUuid(node.guid_holding);
      }
    }

    if (!record.guid_holding || record.guid_holding.trim().length === 0) {
      pushIssue(
        issues,
        { code: "HOLDING_V2_MISSING_HOLDING_GUID", field: "guid_holding", index: sourceIndex },
        issueCount,
      );
      continue;
    }
    const rootId = normalizeUuid(record.guid_holding);
    const selfId = normalizeUuid(record.guid_client);
    if (selfId !== rootId) {
      const head = byGuid.get(rootId);
      if (!head || !isHoldingV2HeadRecord(head)) {
        pushIssue(
          issues,
          { code: "HOLDING_V2_MISSING_HEAD", field: "guid_holding", index: sourceIndex },
          issueCount,
        );
        clusterErrors.add(rootId);
      } else if (!isHoldingV2HeadRecord(record) && record.retailOutlets.length > 0) {
        pushIssue(
          issues,
          { code: "HOLDING_V2_NON_HEAD_OUTLETS", field: "retail_outlets", index: sourceIndex },
          issueCount,
        );
        clusterErrors.add(rootId);
      } else if (head && !isHoldingV2HeadRecord(head)) {
        pushIssue(
          issues,
          { code: "HOLDING_V2_INDIRECT_HOLDING_LINK", field: "guid_holding", index: sourceIndex },
          issueCount,
        );
        clusterErrors.add(rootId);
      }
    }
  }

  const membersByHolding = new Map<string, ParsedExtendedClientRecord[]>();
  for (const record of records) {
    if (!record.guid_holding) {
      continue;
    }
    const rootId = normalizeUuid(record.guid_holding);
    const list = membersByHolding.get(rootId) ?? [];
    list.push(record);
    membersByHolding.set(rootId, list);
  }

  for (const [holdingId, members] of membersByHolding) {
    const head = members.find((m) => isHoldingV2HeadRecord(m));
    if (!head) {
      clusterErrors.add(holdingId);
      distribution.unknown += 1;
      continue;
    }
    const headSourceIndex = sourceIndexByRecord.get(head)!;
    const rawHead = rawRecords[headSourceIndex] as Record<string, unknown> | undefined;
    const rawOutlets = rawHead?.retail_outlets;
    if (Array.isArray(rawOutlets)) {
      for (let outletIndex = 0; outletIndex < rawOutlets.length; outletIndex += 1) {
        validateOutletHoldingRef(
          rawOutlets[outletIndex],
          holdingId,
          headSourceIndex,
          outletIndex,
          issues,
          issueCount,
        );
      }
    }

    const membershipComplete = !clusterErrors.has(holdingId);
    const legalEntities = new Set(members.map((m) => normalizeUuid(m.guid_client)));
    const outletAnalysis = analyzeOutletsForHoldingComposition(head.retailOutlets);

    const siteType = classifyHoldingCompositionSiteType({
      legalEntityCount: legalEntities.size,
      activeOutletCount: outletAnalysis.activeUniqueGuidCount,
      membershipComplete,
      compositionDataComplete: outletAnalysis.compositionDataComplete,
    });
    compositionByHolding.set(holdingId, siteType);
    distribution[siteType] += 1;
  }

  const uniqueOutletGuids = new Set<string>();
  const activeOutletGuids = new Set<string>();
  const closedOutletGuids = new Set<string>();
  const unknownClosureGuids = new Set<string>();
  let outletRowsWithoutGuidStore = 0;

  for (const { record } of indexedRecords) {
    if (!isHoldingV2HeadRecord(record)) {
      continue;
    }
    for (const o of record.retailOutlets) {
      if (o.outletGuidStatus !== "confirmed" || !o.guidStore?.trim()) {
        outletRowsWithoutGuidStore += 1;
        continue;
      }
      const g = o.guidStore.toLowerCase();
      uniqueOutletGuids.add(g);
      if (o.closureStatus === "open") {
        activeOutletGuids.add(g);
      } else if (o.closureStatus === "closed") {
        closedOutletGuids.add(g);
      } else {
        unknownClosureGuids.add(g);
      }
    }
  }

  const holdingRootCount = records.filter((r) => isHoldingV2HeadRecord(r)).length;

  const diagnostics: HoldingV2DiagnosticsSummary = {
    legalEntityRowCount: records.length,
    holdingRootCount,
    uniqueOutletGuidCount: uniqueOutletGuids.size,
    activeOutletGuidCount: activeOutletGuids.size,
    closedOutletGuidCount: closedOutletGuids.size,
    unknownClosureOutletGuidCount: unknownClosureGuids.size,
    outletRowsWithoutGuidStore,
    compositionTypeDistribution: distribution,
  };

  return { compositionByHolding, diagnostics };
}

function validateOutletHoldingRef(
  rawOutlet: unknown,
  expectedHoldingId: string,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): void {
  if (!rawOutlet || typeof rawOutlet !== "object" || Array.isArray(rawOutlet)) {
    return;
  }
  const row = rawOutlet as Record<string, unknown>;
  if (!("guid_holding" in row)) {
    return;
  }
  if (typeof row.guid_holding !== "string") {
    pushIssue(
      issues,
      {
        code: "INVALID_TYPE",
        field: "retail_outlets.guid_holding",
        index: clientIndex,
        outletIndex,
      },
      issueCount,
    );
    return;
  }
  const trimmed = row.guid_holding.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (normalizeUuid(trimmed) !== expectedHoldingId) {
    pushIssue(
      issues,
      {
        code: "HOLDING_V2_OUTLET_HOLDING_MISMATCH",
        field: "retail_outlets.guid_holding",
        index: clientIndex,
        outletIndex,
      },
      issueCount,
    );
  }
}

export function annotateHoldingV2LinkStates(records: ParsedExtendedClientRecord[]): void {
  for (const record of records) {
    record.holdingLinkState = record.guid_holding ? "resolved" : "none";
  }
}
