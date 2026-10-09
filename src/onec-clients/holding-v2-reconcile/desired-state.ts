import type { ValidatedClientsPayload } from "../types";
import { isHoldingV2HeadRecord } from "../holding-v2-structure";
import { normalizeUuid } from "../uuid";
import type { HoldingV2DesiredSnapshot, HoldingV2DesiredTypeCategoryPatch } from "./types";

function typeCategoryPatch(
  scope: "client" | "outlet",
  key: string,
  typeCategory: import("../type-category-exchange-fields").ParsedTypeCategoryExchange,
): HoldingV2DesiredTypeCategoryPatch | null {
  if (!typeCategory.objectPresentInSource) {
    return null;
  }
  return {
    scope,
    key,
    objectPresentInSource: typeCategory.objectPresentInSource,
    fieldPresence: { ...typeCategory.fieldPresence },
    guidType: typeCategory.guidType,
    nameType: typeCategory.nameType,
    guidCategory: typeCategory.guidCategory,
    nameCategory: typeCategory.nameCategory,
  };
}

/** Build order-independent desired link map from a validated v2 payload. */
export type BuildHoldingV2DesiredSnapshotResult =
  | { ok: true; desired: HoldingV2DesiredSnapshot }
  | { ok: false; message: string };

export function buildHoldingV2DesiredSnapshot(
  payload: ValidatedClientsPayload,
): BuildHoldingV2DesiredSnapshotResult {
  if (payload.holdingExchangeSchema !== "v2") {
    return { ok: false, message: "Payload is not holding exchange schema v2." };
  }
  const records = payload.extendedRecords;
  if (!records || records.length === 0) {
    return { ok: false, message: "Missing extendedRecords on v2 payload." };
  }

  const recordsByClient = new Map(records.map((r) => [normalizeUuid(r.guid_client), r]));
  const membersByHolding = new Map<string, typeof records>();
  const clusterErrors = new Set<string>();

  for (const record of records) {
    if (!record.guid_holding?.trim()) {
      continue;
    }
    const root = normalizeUuid(record.guid_holding);
    const list = membersByHolding.get(root) ?? [];
    list.push(record);
    membersByHolding.set(root, list);
  }

  for (const record of records) {
    if (!record.guid_holding?.trim()) {
      continue;
    }
    const root = normalizeUuid(record.guid_holding);
    const self = normalizeUuid(record.guid_client);
    if (self !== root) {
      const head = recordsByClient.get(root);
      if (!head || !isHoldingV2HeadRecord(head)) {
        clusterErrors.add(root);
      } else if (!isHoldingV2HeadRecord(record) && record.retailOutlets.length > 0) {
        clusterErrors.add(root);
      }
    }
  }

  const holdingsInSnapshot: string[] = [];
  const membershipCompleteHoldings = new Set<string>();
  const legalLinks: HoldingV2DesiredSnapshot["legalLinks"] = [];
  const outletLinks: HoldingV2DesiredSnapshot["outletLinks"] = [];
  const typeCategoryPatches: HoldingV2DesiredTypeCategoryPatch[] = [];

  for (const [holdingRoot, members] of membersByHolding) {
    const head = members.find((m) => isHoldingV2HeadRecord(m));
    if (!head) {
      clusterErrors.add(holdingRoot);
      continue;
    }
    holdingsInSnapshot.push(holdingRoot);
    if (!clusterErrors.has(holdingRoot)) {
      membershipCompleteHoldings.add(holdingRoot);
    }

    for (const member of members) {
      legalLinks.push({
        guidClient: normalizeUuid(member.guid_client),
        guidHoldingRoot: holdingRoot,
        isHoldingHead: isHoldingV2HeadRecord(member),
      });
      const clientPatch = typeCategoryPatch("client", normalizeUuid(member.guid_client), member.typeCategory);
      if (clientPatch) {
        typeCategoryPatches.push(clientPatch);
      }
    }

    if (!isHoldingV2HeadRecord(head)) {
      continue;
    }

    const outletsPresent = head.fieldPresence.retailOutlets !== "missing";
    if (!outletsPresent) {
      continue;
    }

    for (const outlet of head.retailOutlets) {
      if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore?.trim()) {
        continue;
      }
      const closureKnown = outlet.closureStatus === "open" || outlet.closureStatus === "closed";
      outletLinks.push({
        guidStore: normalizeUuid(outlet.guidStore),
        guidHoldingRoot: holdingRoot,
        isClosed: closureKnown ? outlet.closed : null,
        closureKnown,
        outlet,
      });
      const outletPatch = typeCategoryPatch("outlet", normalizeUuid(outlet.guidStore), outlet.typeCategory);
      if (outletPatch) {
        typeCategoryPatches.push(outletPatch);
      }
    }
  }

  legalLinks.sort((a, b) => a.guidClient.localeCompare(b.guidClient));
  outletLinks.sort((a, b) => a.guidStore.localeCompare(b.guidStore));
  typeCategoryPatches.sort((a, b) => a.key.localeCompare(b.key));
  holdingsInSnapshot.sort();

  return {
    ok: true,
    desired: {
      sourceSha256: payload.sha256,
      holdingsInSnapshot,
      membershipCompleteHoldings,
      legalLinks,
      outletLinks,
      typeCategoryPatches,
      recordsByClient,
    },
  };
}
