import { isHoldingV2HeadRecord } from "../holding-v2-structure";
import type { HoldingV2DesiredSnapshot, HoldingV2PersistedState } from "./types";

export type ReconcilePreApplyErrorCode =
  | "OUTLET_COMPOSITION_INCOMPLETE"
  | "ORPHAN_HOLDING_LINKS"
  | "TYPE_CATEGORY_EXPLICIT_NULL";

export function validateOutletCompositionForReconcile(
  desired: HoldingV2DesiredSnapshot,
): ReconcilePreApplyErrorCode | null {
  for (const holdingRoot of desired.holdingsInSnapshot) {
    const head = desired.recordsByClient.get(holdingRoot);
    if (!head || !isHoldingV2HeadRecord(head)) {
      continue;
    }
    if (head.fieldPresence.retailOutlets === "missing") {
      continue;
    }
    for (const outlet of head.retailOutlets) {
      if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore?.trim()) {
        return "OUTLET_COMPOSITION_INCOMPLETE";
      }
    }
  }
  return null;
}

export function findOrphanActiveLinks(state: HoldingV2PersistedState): boolean {
  const activeHeadRoots = new Set(
    state.legalLinks
      .filter(
        (l) =>
          l.linkActive &&
          l.isHoldingHead &&
          l.guidClient.toLowerCase() === l.guidHoldingRoot.toLowerCase(),
      )
      .map((l) => l.guidHoldingRoot.toLowerCase()),
  );

  for (const link of state.legalLinks) {
    if (!link.linkActive) {
      continue;
    }
    if (!activeHeadRoots.has(link.guidHoldingRoot.toLowerCase())) {
      return true;
    }
  }
  for (const link of state.outletLinks) {
    if (!link.linkActive) {
      continue;
    }
    if (!activeHeadRoots.has(link.guidHoldingRoot.toLowerCase())) {
      return true;
    }
  }
  return false;
}
