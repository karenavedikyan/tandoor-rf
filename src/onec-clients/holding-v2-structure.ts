import type { ParsedExtendedClientRecord, ParsedRetailOutlet } from "./extended-types";
import type { ExtendedValidationIssue } from "./extended-types";
import {
  classifyHoldingCompositionSiteType,
  countActiveOutlets,
  type HoldingCompositionSiteType,
} from "./holding-v2-composition";
import { normalizeUuid } from "./uuid";

export type HoldingExchangeSchema = "legacy" | "v2";

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

export function validateHoldingV2Structure(
  records: ParsedExtendedClientRecord[],
  rawRecords: unknown[],
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): Map<string, HoldingCompositionSiteType> {
  const compositionByHolding = new Map<string, HoldingCompositionSiteType>();
  const byGuid = new Map(records.map((r) => [normalizeUuid(r.guid_client), r]));
  const clusterErrors = new Set<string>();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (!record.guid_holding || record.guid_holding.trim().length === 0) {
      pushIssue(
        issues,
        { code: "HOLDING_V2_MISSING_HOLDING_GUID", field: "guid_holding", index },
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
          { code: "HOLDING_V2_MISSING_HEAD", field: "guid_holding", index },
          issueCount,
        );
        clusterErrors.add(rootId);
      } else if (!isHoldingV2HeadRecord(record) && record.retailOutlets.length > 0) {
        pushIssue(
          issues,
          { code: "HOLDING_V2_NON_HEAD_OUTLETS", field: "retail_outlets", index },
          issueCount,
        );
        clusterErrors.add(rootId);
      }
      if (head && !isHoldingV2HeadRecord(head)) {
        pushIssue(
          issues,
          { code: "HOLDING_V2_INDIRECT_HOLDING_LINK", field: "guid_holding", index },
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
      continue;
    }
    const headIndex = records.indexOf(head);
    const rawHead = rawRecords[headIndex] as Record<string, unknown> | undefined;
    const rawOutlets = rawHead?.retail_outlets;
    if (Array.isArray(rawOutlets)) {
      for (let outletIndex = 0; outletIndex < rawOutlets.length; outletIndex += 1) {
        validateOutletHoldingRef(
          rawOutlets[outletIndex],
          holdingId,
          headIndex,
          outletIndex,
          issues,
          issueCount,
        );
      }
    }

    if (clusterErrors.has(holdingId)) {
      compositionByHolding.set(holdingId, "unknown");
      continue;
    }

    const legalEntities = new Set(members.map((m) => normalizeUuid(m.guid_client)));
    const headOutlets: ParsedRetailOutlet[] = head.retailOutlets;
    const activeCount = countActiveOutlets(
      headOutlets.map((o) => ({ closureStatus: o.closureStatus, guidStore: o.guidStore })),
    );
    compositionByHolding.set(
      holdingId,
      classifyHoldingCompositionSiteType({
        legalEntityCount: legalEntities.size,
        activeOutletCount: activeCount,
        membershipComplete: true,
      }),
    );
  }

  return compositionByHolding;
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
