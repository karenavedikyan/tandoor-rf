import { isDeepStrictEqual } from "node:util";
import type {
  OutletProvenance,
  ParsedManagerRef,
  ParsedRetailOutlet,
  RetailOutletClosureHistoryEntry,
  RetailOutletHistoryEntry,
} from "./extended-types";
import type { FieldPresenceState } from "./extended-presence";

export type OutletGuidRegistryRow = {
  guid_store: string;
  guid_client: string;
  is_closed: boolean | null;
  last_source_sha256: string | null;
  last_imported_at: string | null;
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

export type OutletMergeResult = {
  outlets: ParsedRetailOutlet[];
  historyEntries: RetailOutletHistoryEntry[];
  outletsInCurrentExport: ParsedRetailOutlet[];
};

type ManagerBusinessRef = Pick<ParsedManagerRef, "guid" | "name" | "state">;

export type OutletBusinessProjection = {
  guidStore: string | null;
  holdingName: string;
  warehouse: boolean | null;
  address: ParsedRetailOutlet["address"];
  loading: ParsedRetailOutlet["loading"];
  managers: {
    manager: ManagerBusinessRef;
    regionalManager: ManagerBusinessRef;
    hardwareManager: ManagerBusinessRef;
    headOfSales: ManagerBusinessRef;
  };
  contacts: ParsedRetailOutlet["contacts"];
  lpr: ParsedRetailOutlet["lpr"];
  additional: ParsedRetailOutlet["additional"];
  closed: boolean | null;
  closureStatus: ParsedRetailOutlet["closureStatus"];
};

function managerBusinessRef(ref: ParsedManagerRef): ManagerBusinessRef {
  return { guid: ref.guid, name: ref.name, state: ref.state };
}

export function outletBusinessProjection(outlet: ParsedRetailOutlet): OutletBusinessProjection {
  return {
    guidStore: outlet.guidStore,
    holdingName: outlet.holdingName,
    warehouse: outlet.warehouse,
    address: outlet.address,
    loading: outlet.loading,
    managers: {
      manager: managerBusinessRef(outlet.managers.manager),
      regionalManager: managerBusinessRef(outlet.managers.regionalManager),
      hardwareManager: managerBusinessRef(outlet.managers.hardwareManager),
      headOfSales: managerBusinessRef(outlet.managers.headOfSales),
    },
    contacts: outlet.contacts,
    lpr: outlet.lpr,
    additional: outlet.additional,
    closed: outlet.closed,
    closureStatus: outlet.closureStatus,
  };
}

export function outletsAreIdentical(left: ParsedRetailOutlet, right: ParsedRetailOutlet): boolean {
  return isDeepStrictEqual(outletBusinessProjection(left), outletBusinessProjection(right));
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

function currentProvenance(context: OutletMergeContext): OutletProvenance {
  return {
    freshness: "current",
    sourceSha256: context.sourceSha256,
    importedAt: context.importedAt,
  };
}

function preservedProvenance(previous: ParsedRetailOutlet | undefined, context: OutletMergeContext): OutletProvenance {
  if (previous?.provenance) {
    return {
      freshness: "absent_from_current_export",
      sourceSha256: previous.provenance.sourceSha256,
      importedAt: previous.provenance.importedAt,
    };
  }
  return {
    freshness: "absent_from_current_export",
    sourceSha256: context.sourceSha256,
    importedAt: context.importedAt,
  };
}

function appendClosureHistory(
  previous: ParsedRetailOutlet | undefined,
  nextClosed: boolean | null,
  nextClosureStatus: ParsedRetailOutlet["closureStatus"],
  closureConfirmedInCurrentExport: boolean,
  context: OutletMergeContext,
): RetailOutletClosureHistoryEntry[] {
  const history = previous?.closureHistory ? [...previous.closureHistory] : [];
  if (!closureConfirmedInCurrentExport) {
    return history;
  }
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
  const closureConfirmedInCurrentExport = incoming.closureConfirmedInCurrentExport;
  const closureStatus =
    incoming.closureStatus === "not_provided" || incoming.closureStatus === "invalid"
      ? previous?.closureStatus ?? incoming.closureStatus
      : incoming.closureStatus;
  const closed =
    closureConfirmedInCurrentExport
      ? incoming.closed
      : previous?.closed ?? incoming.closed;

  return {
    ...incoming,
    closureStatus,
    closed,
    closureConfirmedInCurrentExport,
    closureHistory: appendClosureHistory(
      previous,
      closed,
      closureStatus,
      closureConfirmedInCurrentExport,
      context,
    ),
    outletGuidStatus: "confirmed",
    provenance: currentProvenance(context),
    distributionAllowed: false,
  };
}

function mergePreservedConfirmedOutlet(
  previous: ParsedRetailOutlet,
  context: OutletMergeContext,
): ParsedRetailOutlet {
  return {
    ...previous,
    provenance: preservedProvenance(previous, context),
    distributionAllowed: false,
  };
}

function mergeAnonymousOutlet(incoming: ParsedRetailOutlet, context: OutletMergeContext): ParsedRetailOutlet {
  return {
    ...incoming,
    provenance: currentProvenance(context),
    distributionAllowed: false,
  };
}

function archiveAnonymousOutlets(
  previousAnonymous: ParsedRetailOutlet[],
  context: OutletMergeContext,
): RetailOutletHistoryEntry | null {
  if (previousAnonymous.length === 0) {
    return null;
  }
  return {
    sourceSha256: context.sourceSha256,
    capturedAt: context.importedAt,
    retailOutlets: previousAnonymous.map((outlet) => ({ ...outlet })),
  };
}

export function mergeRetailOutletsWithIdentity(
  incoming: ParsedRetailOutlet[],
  presence: FieldPresenceState,
  previous: ParsedRetailOutlet[] | undefined,
  context: OutletMergeContext,
): OutletMergeResult {
  if (presence === "missing" && previous) {
    return {
      outlets: previous,
      historyEntries: [],
      outletsInCurrentExport: [],
    };
  }
  if (presence === "explicit_null") {
    return { outlets: [], historyEntries: [], outletsInCurrentExport: [] };
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

  const previousAnonymous = previousOutlets.filter(
    (outlet) => outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore,
  );
  const historyEntries: RetailOutletHistoryEntry[] = [];
  if (incomingConfirmed.length > 0 && previousAnonymous.length > 0) {
    const archived = archiveAnonymousOutlets(previousAnonymous, context);
    if (archived) {
      historyEntries.push(archived);
    }
  }

  const result: ParsedRetailOutlet[] = [];
  const outletsInCurrentExport: ParsedRetailOutlet[] = [];

  for (const previousOutlet of previousOutlets) {
    if (previousOutlet.outletGuidStatus === "confirmed" && previousOutlet.guidStore) {
      if (!incomingGuidSet.has(previousOutlet.guidStore.toLowerCase())) {
        result.push(mergePreservedConfirmedOutlet(previousOutlet, context));
      }
    }
  }

  for (const outlet of incomingConfirmed) {
    const previousOutlet = previousByGuid.get(outlet.guidStore!.toLowerCase());
    const merged = mergeConfirmedOutlet(outlet, previousOutlet, context);
    result.push(merged);
    outletsInCurrentExport.push(merged);
  }

  for (const outlet of incomingAnonymous) {
    const merged = mergeAnonymousOutlet(outlet, context);
    result.push(merged);
    outletsInCurrentExport.push(merged);
  }

  return {
    outlets: result.map((outlet, index) => ({ ...outlet, ordinal: index })),
    historyEntries,
    outletsInCurrentExport,
  };
}

export function deriveRetailOutletsBlockFreshness(
  outlets: ParsedRetailOutlet[],
  presence: FieldPresenceState,
  hasPrevious: boolean,
): "current" | "preserved_from_previous" | "not_provided_in_snapshot" {
  if (presence === "missing") {
    return hasPrevious ? "preserved_from_previous" : "not_provided_in_snapshot";
  }
  if (presence === "explicit_null") {
    return "not_provided_in_snapshot";
  }
  const freshValues = outlets.map((outlet) => outlet.provenance.freshness);
  if (freshValues.every((value) => value === "current")) {
    return "current";
  }
  if (freshValues.some((value) => value === "absent_from_current_export" || value === "preserved_from_previous")) {
    return "preserved_from_previous";
  }
  return "not_provided_in_snapshot";
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

export function countOutletGuidRowStats(records: Array<{ retailOutlets: ParsedRetailOutlet[] }>): {
  outletSourceRowCount: number;
  outletUniqueGuidCount: number;
} {
  let outletSourceRowCount = 0;
  const uniqueGuids = new Set<string>();
  for (const record of records) {
    for (const outlet of record.retailOutlets) {
      if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
        outletSourceRowCount += 1;
        uniqueGuids.add(outlet.guidStore.toLowerCase());
      }
    }
  }
  return { outletSourceRowCount, outletUniqueGuidCount: uniqueGuids.size };
}

export function outletsFieldsComplete(outlets: ParsedRetailOutlet[]): boolean {
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
