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

export function classifyHoldingCompositionSiteType(input: {
  legalEntityCount: number;
  activeOutletCount: number;
  membershipComplete: boolean;
}): HoldingCompositionSiteType {
  if (!input.membershipComplete || input.legalEntityCount <= 0) {
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

export function countActiveOutlets(
  outlets: Array<{ closureStatus: string; guidStore: string | null }>,
): number {
  const seen = new Set<string>();
  for (const outlet of outlets) {
    if (outlet.closureStatus === "closed") {
      continue;
    }
    if (outlet.closureStatus !== "open") {
      continue;
    }
    const g = (outlet.guidStore ?? "").trim().toLowerCase();
    if (g) {
      seen.add(g);
    }
  }
  return seen.size;
}
