/** Site holding composition labels (1С does not send this classification). */
export type HoldingCompositionSiteType =
  | "mono"
  | "mono_network"
  | "group"
  | "group_network"
  | "no_active_outlets"
  | "unknown";

export const HOLDING_COMPOSITION_SITE_LABELS: Record<HoldingCompositionSiteType, string> = {
  mono: "Холдинг моно",
  mono_network: "Холдинг моно сеть",
  group: "Холдинг групп",
  group_network: "Холдинг групп сеть",
  no_active_outlets: "Без действующих ТТ",
  unknown: "Неизвестно",
};

export type OutletCompositionAnalysis = {
  activeUniqueGuidCount: number;
  closedUniqueGuidCount: number;
  unknownClosureGuidCount: number;
  rowsWithoutGuidStore: number;
  /** False when closure or guid identity is insufficient for site type. */
  compositionDataComplete: boolean;
};

export function analyzeOutletsForHoldingComposition(
  outlets: Array<{
    closureStatus: string;
    guidStore: string | null;
    outletGuidStatus: string;
  }>,
): OutletCompositionAnalysis {
  const active = new Set<string>();
  const closed = new Set<string>();
  const unknownClosure = new Set<string>();
  let rowsWithoutGuidStore = 0;
  let compositionDataComplete = true;

  for (const outlet of outlets) {
    if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore?.trim()) {
      rowsWithoutGuidStore += 1;
      compositionDataComplete = false;
      continue;
    }
    const g = outlet.guidStore.trim().toLowerCase();
    if (outlet.closureStatus === "open") {
      active.add(g);
    } else if (outlet.closureStatus === "closed") {
      closed.add(g);
    } else {
      unknownClosure.add(g);
      compositionDataComplete = false;
    }
  }

  return {
    activeUniqueGuidCount: active.size,
    closedUniqueGuidCount: closed.size,
    unknownClosureGuidCount: unknownClosure.size,
    rowsWithoutGuidStore,
    compositionDataComplete,
  };
}

export function classifyHoldingCompositionSiteType(input: {
  legalEntityCount: number;
  activeOutletCount: number;
  membershipComplete: boolean;
  compositionDataComplete: boolean;
}): HoldingCompositionSiteType {
  if (!input.membershipComplete || input.legalEntityCount <= 0 || !input.compositionDataComplete) {
    return "unknown";
  }
  if (input.activeOutletCount <= 0) {
    return "no_active_outlets";
  }
  if (input.legalEntityCount === 1 && input.activeOutletCount === 1) {
    return "mono";
  }
  if (input.legalEntityCount === 1 && input.activeOutletCount > 1) {
    return "mono_network";
  }
  if (input.legalEntityCount > 1 && input.activeOutletCount === 1) {
    return "group";
  }
  if (input.legalEntityCount > 1 && input.activeOutletCount > 1) {
    return "group_network";
  }
  return "unknown";
}

/** @deprecated use analyzeOutletsForHoldingComposition */
export function countActiveOutlets(
  outlets: Array<{ closureStatus: string; guidStore: string | null }>,
): number {
  return analyzeOutletsForHoldingComposition(
    outlets.map((o) => ({
      ...o,
      outletGuidStatus: o.guidStore ? "confirmed" : "not_provided",
    })),
  ).activeUniqueGuidCount;
}
