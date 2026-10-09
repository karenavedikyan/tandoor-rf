import type { HoldingCompositionSiteType } from "./holding-v2-composition";

export type HoldingV2DiagnosticsSummary = {
  legalEntityRowCount: number;
  holdingRootCount: number;
  uniqueOutletGuidCount: number;
  activeOutletGuidCount: number;
  closedOutletGuidCount: number;
  unknownClosureOutletGuidCount: number;
  outletRowsWithoutGuidStore: number;
  compositionTypeDistribution: Record<HoldingCompositionSiteType, number>;
};

export function emptyCompositionDistribution(): Record<HoldingCompositionSiteType, number> {
  return {
    mono: 0,
    mono_network: 0,
    group: 0,
    group_network: 0,
    no_active_outlets: 0,
    unknown: 0,
  };
}
