import { isDeepStrictEqual } from "node:util";
import type {
  ParsedRetailOutlet,
  RetailOutletClosureHistoryEntry,
} from "./extended-types";
import type { FieldPresenceState } from "./extended-presence";

export type OutletGuidRegistryRow = {
  guid_store: string;
  guid_client: string;
  is_closed: boolean | null;
  closure_history: RetailOutletClosureHistoryEntry[];
};

export type OutletIdentityConflict = {
  guidStore: string;
  existingClientGuid: string;
  incomingClientGuid: string;
};

export type OutletMergeContext = {
  sourceSha256: string;
  importedAt: string;
};

function outletBusinessFingerprint(outlet: ParsedRetailOutlet): string {
  return JSON.stringify({
    guidStore: outlet.guidStore,
    holdingName: outlet.holdingName,
    warehouse: outlet.warehouse,
    address: outlet.address,
    closed: outlet.closed,
    closureStatus: outlet.closureStatus,
  });
}

export function outletsAreIdentical(left: ParsedRetailOutlet, right: ParsedRetailOutlet): boolean {
  return outletBusinessFingerprint(left) === outletBusinessFingerprint(right);
}

export function dedupeIdenticalOutlets(outlets: ParsedRetailOutlet[]): ParsedRetailOutlet[] {
  const seen = new Set<string>();
  const result: ParsedRetailOutlet[] = [];
  for (const outlet of outlets) {
    if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
      result.push(outlet);
      continue;
    }
    const key = outlet.guidStore.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(outlet);
  }
  return result;
}

function appendClosureHistory(
  previous: ParsedRetailOutlet | undefined,
  nextClosed: boolean | null,
  nextClosureStatus: ParsedRetailOutlet["closureStatus"],
  context: OutletMergeContext,
): RetailOutletClosureHistoryEntry[] {
  const history = previous?.closureHistory ? [...previous.closureHistory] : [];
  if (nextClosureStatus !== "open" && nextClosureStatus !== "closed") {
    return history;
  }
  if (nextClosed === null) {
    return history;
  }
  const previousClosed = previous?.closed ?? null;
  if (previousClosed === nextClosed) {
    return history;
  }
  history.push({
    closed: nextClosed,
    sourceSha256: context.sourceSha256,
    capturedAt: context.importedAt,
  });
  return history;
}

function mergeConfirmedOutlet(
  incoming: ParsedRetailOutlet,
  previous: ParsedRetailOutlet | undefined,
  context: OutletMergeContext,
): ParsedRetailOutlet {
  const closureStatus =
    incoming.closureStatus === "not_provided" || incoming.closureStatus === "invalid"
      ? previous?.closureStatus ?? incoming.closureStatus
      : incoming.closureStatus;
  const closed =
    incoming.closureStatus === "open" || incoming.closureStatus === "closed"
      ? incoming.closed
      : previous?.closed ?? incoming.closed;

  return {
    ...incoming,
    closureStatus,
    closed,
    closureHistory: appendClosureHistory(previous, closed, closureStatus, context),
    outletGuidStatus: "confirmed",
    distributionAllowed: false,
  };
}

function mergeAnonymousOutlet(incoming: ParsedRetailOutlet): ParsedRetailOutlet {
  return {
    ...incoming,
    distributionAllowed: false,
  };
}

export function mergeRetailOutletsWithIdentity(
  incoming: ParsedRetailOutlet[],
  presence: FieldPresenceState,
  previous: ParsedRetailOutlet[] | undefined,
  context: OutletMergeContext,
): ParsedRetailOutlet[] {
  if (presence === "missing" && previous) {
    return previous;
  }
  if (presence === "explicit_null") {
    return [];
  }

  const previousOutlets = previous ?? [];
  const previousByGuid = new Map<string, ParsedRetailOutlet>();
  for (const outlet of previousOutlets) {
    if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
      previousByGuid.set(outlet.guidStore.toLowerCase(), outlet);
    }
  }

  const dedupedIncoming = dedupeIdenticalOutlets(incoming);
  const incomingConfirmed = dedupedIncoming.filter(
    (outlet) => outlet.outletGuidStatus === "confirmed" && outlet.guidStore,
  );
  const incomingAnonymous = dedupedIncoming.filter(
    (outlet) => outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore,
  );
  const incomingGuidSet = new Set(
    incomingConfirmed.map((outlet) => outlet.guidStore!.toLowerCase()),
  );

  const result: ParsedRetailOutlet[] = [];

  for (const previousOutlet of previousOutlets) {
    if (previousOutlet.outletGuidStatus === "confirmed" && previousOutlet.guidStore) {
      if (!incomingGuidSet.has(previousOutlet.guidStore.toLowerCase())) {
        result.push(previousOutlet);
      }
    }
  }

  for (const outlet of incomingConfirmed) {
    const previousOutlet = previousByGuid.get(outlet.guidStore!.toLowerCase());
    result.push(mergeConfirmedOutlet(outlet, previousOutlet, context));
  }

  for (const outlet of incomingAnonymous) {
    result.push(mergeAnonymousOutlet(outlet));
  }

  const previousAnonymous = previousOutlets.filter(
    (outlet) => outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore,
  );
  if (incomingAnonymous.length === 0 && incomingConfirmed.length > 0) {
    for (const outlet of previousAnonymous) {
      result.push(outlet);
    }
  }

  return result.map((outlet, index) => ({ ...outlet, ordinal: index }));
}

export function detectRegistryParentConflicts(
  clientGuid: string,
  outlets: ParsedRetailOutlet[],
  registry: ReadonlyMap<string, OutletGuidRegistryRow>,
): OutletIdentityConflict[] {
  const conflicts: OutletIdentityConflict[] = [];
  for (const outlet of outlets) {
    if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
      continue;
    }
    const key = outlet.guidStore.toLowerCase();
    const existing = registry.get(key);
    if (existing && existing.guid_client.toLowerCase() !== clientGuid.toLowerCase()) {
      conflicts.push({
        guidStore: outlet.guidStore,
        existingClientGuid: existing.guid_client,
        incomingClientGuid: clientGuid,
      });
    }
  }
  return conflicts;
}

export function countOutletDiagnostics(outlets: ParsedRetailOutlet[]): {
  outletsWithGuid: number;
  outletsWithoutGuid: number;
  outletsOpen: number;
  outletsClosed: number;
  outletsUnknownClosure: number;
} {
  let outletsWithGuid = 0;
  let outletsWithoutGuid = 0;
  let outletsOpen = 0;
  let outletsClosed = 0;
  let outletsUnknownClosure = 0;

  for (const outlet of outlets) {
    if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
      outletsWithGuid += 1;
    } else {
      outletsWithoutGuid += 1;
    }
    if (outlet.closureStatus === "open") {
      outletsOpen += 1;
    } else if (outlet.closureStatus === "closed") {
      outletsClosed += 1;
    } else {
      outletsUnknownClosure += 1;
    }
  }

  return {
    outletsWithGuid,
    outletsWithoutGuid,
    outletsOpen,
    outletsClosed,
    outletsUnknownClosure,
  };
}

export function outletsFullyNormalized(outlets: ParsedRetailOutlet[]): boolean {
  if (outlets.length === 0) {
    return false;
  }
  return outlets.every(
    (outlet) =>
      outlet.outletGuidStatus === "confirmed" &&
      outlet.guidStore &&
      (outlet.closureStatus === "open" || outlet.closureStatus === "closed"),
  );
}

export function countKnownOutletsMissingFromSnapshot(
  clientGuid: string,
  currentOutlets: ParsedRetailOutlet[],
  registry: ReadonlyMap<string, OutletGuidRegistryRow>,
): number {
  const currentGuids = new Set(
    currentOutlets
      .filter((outlet) => outlet.outletGuidStatus === "confirmed" && outlet.guidStore)
      .map((outlet) => outlet.guidStore!.toLowerCase()),
  );
  let missing = 0;
  for (const [guid, row] of registry) {
    if (row.guid_client.toLowerCase() === clientGuid.toLowerCase() && !currentGuids.has(guid)) {
      missing += 1;
    }
  }
  return missing;
}

export function registryRowsEqual(
  left: OutletGuidRegistryRow | undefined,
  right: Pick<OutletGuidRegistryRow, "guid_client" | "is_closed">,
): boolean {
  if (!left) {
    return false;
  }
  return (
    left.guid_client.toLowerCase() === right.guid_client.toLowerCase() &&
    left.is_closed === right.is_closed
  );
}

export function outletRegistrySnapshot(outlet: ParsedRetailOutlet): Pick<
  OutletGuidRegistryRow,
  "guid_store" | "guid_client" | "is_closed" | "closure_history"
> | null {
  if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
    return null;
  }
  return {
    guid_store: outlet.guidStore,
    guid_client: "",
    is_closed: outlet.closed,
    closure_history: outlet.closureHistory,
  };
}

export function extendedOutletListsEqual(
  left: ParsedRetailOutlet[],
  right: ParsedRetailOutlet[],
): boolean {
  return isDeepStrictEqual(left, right);
}
