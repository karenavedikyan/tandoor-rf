import { isDeepStrictEqual } from "node:util";
import { normalizeLocalTimeForComparison } from "./field-value";
import type {
  OutletProvenance,
  ParsedManagerRef,
  ParsedOutletLoading,
  ParsedOutletLpr,
  ParsedRetailOutlet,
  RetailOutletClosureHistoryEntry,
  RetailOutletHistoryEntry,
} from "./extended-types";
import { mergeManagerField, type FieldPresenceState } from "./extended-presence";

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

export type OutletBusinessLoading = {
  loadingOnMonday: boolean | null;
  loadingOnTuesday: boolean | null;
  loadingOnWednesday: boolean | null;
  loadingOnThursday: boolean | null;
  loadingOnFriday: boolean | null;
  loadingOnSaturday: boolean | null;
  loadingOnSunday: boolean | null;
  loadingTime: string | null;
};

export type OutletBusinessLpr = {
  name: string;
  post: string;
  dateOfBirth: string | null;
  phone: string;
  email: string;
  bonus: string;
  conditionsBonus: string;
};

export type OutletBusinessProjection = {
  guidStore: string | null;
  holdingName: string;
  warehouse: boolean | null;
  address: ParsedRetailOutlet["address"];
  loading: OutletBusinessLoading;
  managers: {
    manager: ManagerBusinessRef;
    regionalManager: ManagerBusinessRef;
    hardwareManager: ManagerBusinessRef;
    headOfSales: ManagerBusinessRef;
  };
  contacts: ParsedRetailOutlet["contacts"];
  lpr: OutletBusinessLpr;
  additional: ParsedRetailOutlet["additional"];
  closed: boolean | null;
  closureStatus: ParsedRetailOutlet["closureStatus"];
};

function managerBusinessRef(ref: ParsedManagerRef): ManagerBusinessRef {
  return { guid: ref.guid, name: ref.name, state: ref.state };
}

function canonicalLoadingForBusiness(loading: ParsedOutletLoading): OutletBusinessLoading {
  return {
    loadingOnMonday: loading.loadingOnMonday,
    loadingOnTuesday: loading.loadingOnTuesday,
    loadingOnWednesday: loading.loadingOnWednesday,
    loadingOnThursday: loading.loadingOnThursday,
    loadingOnFriday: loading.loadingOnFriday,
    loadingOnSaturday: loading.loadingOnSaturday,
    loadingOnSunday: loading.loadingOnSunday,
    loadingTime:
      loading.loadingTime != null
        ? normalizeLocalTimeForComparison(loading.loadingTime)
        : null,
  };
}

function canonicalLprForBusiness(lpr: ParsedOutletLpr): OutletBusinessLpr {
  return {
    name: lpr.name,
    post: lpr.post,
    dateOfBirth: lpr.dateOfBirth,
    phone: lpr.phone,
    email: lpr.email,
    bonus: lpr.bonus,
    conditionsBonus: lpr.conditionsBonus,
  };
}

export function outletBusinessProjection(outlet: ParsedRetailOutlet): OutletBusinessProjection {
  return {
    guidStore: outlet.guidStore,
    holdingName: outlet.holdingName,
    warehouse: outlet.warehouse,
    address: outlet.address,
    loading: canonicalLoadingForBusiness(outlet.loading),
    managers: {
      manager: managerBusinessRef(outlet.managers.manager),
      regionalManager: managerBusinessRef(outlet.managers.regionalManager),
      hardwareManager: managerBusinessRef(outlet.managers.hardwareManager),
      headOfSales: managerBusinessRef(outlet.managers.headOfSales),
    },
    contacts: outlet.contacts,
    lpr: canonicalLprForBusiness(outlet.lpr),
    additional: outlet.additional,
    closed: outlet.closed,
    closureStatus: outlet.closureStatus,
  };
}

export function outletsAreIdentical(left: ParsedRetailOutlet, right: ParsedRetailOutlet): boolean {
  return isDeepStrictEqual(outletBusinessProjection(left), outletBusinessProjection(right));
}

/** Import-state for duplicate-row checks within one file (not business-history equality). */
function loadingTimeImportState(loading: ParsedOutletLoading): string {
  if (loading.loadingTimeAmbiguous) {
    return "ambiguous";
  }
  if (loading.loadingTime != null) {
    return `value:${normalizeLocalTimeForComparison(loading.loadingTime)}`;
  }
  return "explicit_empty";
}

function dateOfBirthImportState(lpr: ParsedOutletLpr): string {
  if (lpr.dateOfBirthExplicitEmpty) {
    return "explicit_empty";
  }
  if (lpr.dateOfBirthAmbiguous) {
    return "ambiguous";
  }
  if (lpr.dateOfBirth != null) {
    return `value:${lpr.dateOfBirth}`;
  }
  return "explicit_empty";
}

export function outletDuplicateRowsEquivalent(
  left: ParsedRetailOutlet,
  right: ParsedRetailOutlet,
): boolean {
  if (loadingTimeImportState(left.loading) !== loadingTimeImportState(right.loading)) {
    return false;
  }
  if (dateOfBirthImportState(left.lpr) !== dateOfBirthImportState(right.lpr)) {
    return false;
  }
  const leftBusiness = outletBusinessProjection(left);
  const rightBusiness = outletBusinessProjection(right);
  return isDeepStrictEqual(leftBusiness, rightBusiness);
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

function preservedProvenance(previous: ParsedRetailOutlet | undefined): OutletProvenance {
  if (previous?.provenance?.sourceSha256) {
    return {
      freshness: "absent_from_current_export",
      sourceSha256: previous.provenance.sourceSha256,
      importedAt: previous.provenance.importedAt,
    };
  }
  if (previous?.provenance) {
    return {
      freshness: "preserved_from_previous",
      sourceSha256: previous.provenance.sourceSha256,
      importedAt: previous.provenance.importedAt,
    };
  }
  return {
    freshness: "preserved_from_previous",
    sourceSha256: "",
    importedAt: "",
  };
}

function preserveOutletFromAbsentExport(previous: ParsedRetailOutlet): ParsedRetailOutlet {
  return {
    ...previous,
    provenance: preservedProvenance(previous),
    closureConfirmedInCurrentExport: false,
    distributionAllowed: false,
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

/** Whether a prior snapshot already established a usable business value (any export). */
function previousLoadingHasConfirmedValue(previous: ParsedOutletLoading | undefined): boolean {
  return previous?.loadingTime != null && previous.loadingTimeAmbiguous !== true;
}

function previousDateOfBirthHasConfirmedValue(previous: ParsedOutletLpr | undefined): boolean {
  return previous?.dateOfBirth != null && previous.dateOfBirthAmbiguous !== true;
}

function preservedFieldProvenance(
  fieldProvenance: OutletProvenance | undefined,
  previousOutlet: ParsedRetailOutlet | undefined,
): OutletProvenance {
  if (fieldProvenance?.sourceSha256) {
    return {
      freshness: "preserved_from_previous",
      sourceSha256: fieldProvenance.sourceSha256,
      importedAt: fieldProvenance.importedAt,
    };
  }
  if (previousOutlet?.provenance?.sourceSha256) {
    return {
      freshness: "preserved_from_previous",
      sourceSha256: previousOutlet.provenance.sourceSha256,
      importedAt: previousOutlet.provenance.importedAt,
    };
  }
  return {
    freshness: "preserved_from_previous",
    sourceSha256: "",
    importedAt: "",
  };
}

function mergeLoadingField(
  incoming: ParsedOutletLoading,
  previous: ParsedOutletLoading | undefined,
  previousOutlet: ParsedRetailOutlet | undefined,
  context: OutletMergeContext,
): ParsedOutletLoading {
  if (incoming.loadingTimeAmbiguous) {
    if (previousLoadingHasConfirmedValue(previous)) {
      return {
        ...incoming,
        loadingTime: previous!.loadingTime,
        loadingTimeSourceRaw: previous!.loadingTimeSourceRaw ?? null,
        loadingTimeAmbiguous: false,
        loadingTimeAmbiguousIncomingRaw: incoming.loadingTimeSourceRaw ?? null,
        loadingTimeConfirmedInCurrentExport: false,
        loadingTimeFieldProvenance: preservedFieldProvenance(
          previous!.loadingTimeFieldProvenance,
          previousOutlet,
        ),
      };
    }
    return {
      ...incoming,
      loadingTime: null,
      loadingTimeAmbiguous: true,
      loadingTimeAmbiguousIncomingRaw: incoming.loadingTimeSourceRaw ?? null,
      loadingTimeConfirmedInCurrentExport: false,
      loadingTimeFieldProvenance: {
        freshness: "not_provided_in_snapshot",
        sourceSha256: "",
        importedAt: "",
      },
    };
  }

  if (incoming.loadingTime != null) {
    return {
      ...incoming,
      loadingTimeAmbiguous: false,
      loadingTimeAmbiguousIncomingRaw: null,
      loadingTimeConfirmedInCurrentExport: true,
      loadingTimeFieldProvenance: currentProvenance(context),
    };
  }

  return {
    ...incoming,
    loadingTimeConfirmedInCurrentExport: false,
    loadingTimeFieldProvenance: previous?.loadingTimeFieldProvenance,
  };
}

function mergeLprField(
  incoming: ParsedOutletLpr,
  previous: ParsedOutletLpr | undefined,
  previousOutlet: ParsedRetailOutlet | undefined,
  context: OutletMergeContext,
): ParsedOutletLpr {
  if (incoming.dateOfBirthExplicitEmpty) {
    return {
      ...incoming,
      dateOfBirth: null,
      dateOfBirthAmbiguous: false,
      dateOfBirthExplicitEmpty: true,
      dateOfBirthAmbiguousIncomingRaw: null,
      dateOfBirthConfirmedInCurrentExport: true,
      dateOfBirthFieldProvenance: currentProvenance(context),
    };
  }

  if (incoming.dateOfBirthAmbiguous) {
    if (previousDateOfBirthHasConfirmedValue(previous)) {
      return {
        ...incoming,
        dateOfBirth: previous!.dateOfBirth,
        dateOfBirthSourceRaw: previous!.dateOfBirthSourceRaw ?? null,
        dateOfBirthAmbiguous: false,
        dateOfBirthAmbiguousIncomingRaw: incoming.dateOfBirthSourceRaw ?? null,
        dateOfBirthConfirmedInCurrentExport: false,
        dateOfBirthFieldProvenance: preservedFieldProvenance(
          previous!.dateOfBirthFieldProvenance,
          previousOutlet,
        ),
      };
    }
    return {
      ...incoming,
      dateOfBirth: null,
      dateOfBirthAmbiguous: true,
      dateOfBirthAmbiguousIncomingRaw: incoming.dateOfBirthSourceRaw ?? null,
      dateOfBirthConfirmedInCurrentExport: false,
      dateOfBirthFieldProvenance: {
        freshness: "not_provided_in_snapshot",
        sourceSha256: "",
        importedAt: "",
      },
    };
  }

  if (incoming.dateOfBirth != null) {
    return {
      ...incoming,
      dateOfBirthAmbiguous: false,
      dateOfBirthAmbiguousIncomingRaw: null,
      dateOfBirthConfirmedInCurrentExport: true,
      dateOfBirthFieldProvenance: currentProvenance(context),
    };
  }

  return {
    ...incoming,
    dateOfBirthConfirmedInCurrentExport: false,
    dateOfBirthFieldProvenance: previous?.dateOfBirthFieldProvenance,
  };
}

function mergeAddressField(
  incoming: ParsedRetailOutlet["address"],
  previous: ParsedRetailOutlet["address"] | undefined,
): ParsedRetailOutlet["address"] {
  const presence = incoming.fieldPresence;
  if (!presence) {
    return incoming;
  }
  const hadAnyField =
    presence.storeAddress || presence.deliveryAddress || presence.routeDirection;
  if (!hadAnyField && previous) {
    return { ...previous, fieldPresence: presence };
  }
  const base = previous ?? incoming;
  return {
    storeAddress: presence.storeAddress ? incoming.storeAddress : base.storeAddress,
    deliveryAddress: presence.deliveryAddress ? incoming.deliveryAddress : base.deliveryAddress,
    routeDirection: presence.routeDirection ? incoming.routeDirection : base.routeDirection,
    fieldPresence: presence,
  };
}

function mergeAdditionalField(
  incoming: ParsedRetailOutlet["additional"],
  previous: ParsedRetailOutlet["additional"] | undefined,
): ParsedRetailOutlet["additional"] {
  const presence = incoming.fieldPresence;
  if (!presence) {
    return incoming;
  }
  const hadAnyField = presence.statusTandoorClub || presence.bonusTandoorClub;
  if (!hadAnyField && previous) {
    return { ...previous, fieldPresence: presence };
  }
  const base = previous ?? incoming;
  return {
    statusTandoorClub: presence.statusTandoorClub
      ? incoming.statusTandoorClub
      : base.statusTandoorClub,
    bonusTandoorClub: presence.bonusTandoorClub ? incoming.bonusTandoorClub : base.bonusTandoorClub,
    fieldPresence: presence,
  };
}

function mergeOutletManagersField(
  incoming: ParsedRetailOutlet["managers"],
  previous: ParsedRetailOutlet["managers"] | undefined,
): ParsedRetailOutlet["managers"] {
  const presence = incoming.fieldPresence;
  if (!presence) {
    return incoming;
  }
  const base = previous ?? incoming;
  return {
    manager: mergeManagerField(incoming.manager, presence.manager, base.manager, false),
    regionalManager: mergeManagerField(
      incoming.regionalManager,
      presence.regionalManager,
      base.regionalManager,
      false,
    ),
    hardwareManager: mergeManagerField(
      incoming.hardwareManager,
      presence.hardwareManager,
      base.hardwareManager,
      false,
    ),
    headOfSales: mergeManagerField(incoming.headOfSales, presence.headOfSales, base.headOfSales, false),
    fieldPresence: presence,
  };
}

function mergeContactsField(
  incoming: ParsedRetailOutlet["contacts"],
  previous: ParsedRetailOutlet["contacts"] | undefined,
): ParsedRetailOutlet["contacts"] {
  const presence = incoming.fieldPresence;
  if (!presence) {
    return incoming;
  }
  const hadAnyField =
    presence.storePhone || presence.accountantPhone || presence.accountantEmail;
  if (!hadAnyField && previous) {
    return { ...previous, fieldPresence: presence };
  }
  const base = previous ?? incoming;
  return {
    storePhone: presence.storePhone ? incoming.storePhone : base.storePhone,
    accountantPhone: presence.accountantPhone ? incoming.accountantPhone : base.accountantPhone,
    accountantEmail: presence.accountantEmail ? incoming.accountantEmail : base.accountantEmail,
    fieldPresence: presence,
  };
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

  const loading = mergeLoadingField(incoming.loading, previous?.loading, previous, context);
  const lpr = mergeLprField(incoming.lpr, previous?.lpr, previous, context);
  const contacts = mergeContactsField(incoming.contacts, previous?.contacts);
  const address = mergeAddressField(incoming.address, previous?.address);
  const additional = mergeAdditionalField(incoming.additional, previous?.additional);
  const managers = mergeOutletManagersField(incoming.managers, previous?.managers);

  return {
    ...incoming,
    loading,
    lpr,
    contacts,
    address,
    additional,
    managers,
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

function mergePreservedConfirmedOutlet(previous: ParsedRetailOutlet): ParsedRetailOutlet {
  return preserveOutletFromAbsentExport(previous);
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
  const origin = previousAnonymous[0]?.provenance;
  return {
    sourceSha256: origin?.sourceSha256 || context.sourceSha256,
    capturedAt: origin?.importedAt || context.importedAt,
    archivedAt: context.importedAt,
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
      outlets: previous.map((outlet) => preserveOutletFromAbsentExport(outlet)),
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
        result.push(mergePreservedConfirmedOutlet(previousOutlet));
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
  const freshValues = outlets.map((outlet) => outlet.provenance?.freshness ?? "preserved_from_previous");
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

export function extractConfirmedOutletGuidsFromSource(
  outlets: ParsedRetailOutlet[],
): ReadonlySet<string> {
  const guids = new Set<string>();
  for (const outlet of outlets) {
    if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
      guids.add(outlet.guidStore.toLowerCase());
    }
  }
  return guids;
}

export function countKnownOutletsMissingFromSnapshot(
  clientGuid: string,
  guidsInCurrentExport: ReadonlySet<string>,
  registry: ReadonlyMap<string, OutletGuidRegistryRow>,
): number {
  let missing = 0;
  for (const [guid, row] of registry) {
    if (row.guid_client.toLowerCase() === clientGuid.toLowerCase() && !guidsInCurrentExport.has(guid)) {
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
