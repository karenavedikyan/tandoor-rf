import type { PoolClient } from "pg";
import {
  blockFreshnessForPresence,
  extendedBusinessDataEqual,
  mergeHoldingFlag,
  mergeManagerField,
  type ExtendedRecordFieldPresence,
} from "./extended-presence";
import {
  deriveRetailOutletsBlockFreshness,
  mergeRetailOutletsWithIdentity,
  outletsAreIdentical,
} from "./outlet-identity";
import type {
  ClientManagerRosterState,
  ExtendedBlockFreshness,
  ExtendedBlockProvenance,
  ExtendedBlockProvenanceEntry,
  ExtendedSnapshot,
  ExtendedSnapshotBlocks,
  ExtendedSnapshotHoldingLink,
  ParsedExtendedClientRecord,
  ParsedRetailOutlet,
  RetailOutletHistoryEntry,
} from "./extended-types";
import type { ValidatedClientsPayload } from "./types";
import {
  hasAnyCommercialField,
  mergeCommercialFields,
  readSnapshotCommercial,
} from "./commercial-fields";

type ExistingExtendedRow = {
  guid_client: string;
  extended_snapshot: unknown;
  extended_source_sha256: string | null;
  extended_imported_at: Date | null;
};

export async function loadLinkedEmployeeGuids(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE revoked_at IS NULL
    `,
  );
  return new Set(result.rows.map((row) => row.employee_id.toLowerCase()));
}

function readExistingSnapshot(snapshot: unknown): ExtendedSnapshot | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const raw = snapshot as ExtendedSnapshot;
  return {
    ...raw,
    holdingLink: raw.holdingLink ?? { state: "none", pendingGuid: null },
    clientManagerRosterState: raw.clientManagerRosterState ?? "roster_not_loaded",
  };
}

function findNextOutletForHistory(
  previousOutlet: ParsedRetailOutlet,
  nextOutlets: ParsedRetailOutlet[],
): ParsedRetailOutlet | undefined {
  if (previousOutlet.outletGuidStatus === "confirmed" && previousOutlet.guidStore) {
    const key = previousOutlet.guidStore.toLowerCase();
    return nextOutlets.find(
      (outlet) =>
        outlet.outletGuidStatus === "confirmed" &&
        outlet.guidStore?.toLowerCase() === key,
    );
  }
  return nextOutlets.find((outlet) => outletsAreIdentical(outlet, previousOutlet));
}

function outletAlreadyArchivedInMerge(
  outlet: ParsedRetailOutlet,
  mergeHistoryEntries: RetailOutletHistoryEntry[],
): boolean {
  return mergeHistoryEntries.some((entry) =>
    entry.retailOutlets.some((archived) => outletsAreIdentical(archived, outlet)),
  );
}

function outletHistoryStateChanged(
  previousOutlet: ParsedRetailOutlet,
  nextOutlet: ParsedRetailOutlet | undefined,
): boolean {
  if (!nextOutlet) {
    return true;
  }
  if (!outletsAreIdentical(previousOutlet, nextOutlet)) {
    return true;
  }
  if (previousOutlet.provenance?.freshness !== nextOutlet.provenance?.freshness) {
    return true;
  }
  if (previousOutlet.closureConfirmedInCurrentExport !== nextOutlet.closureConfirmedInCurrentExport) {
    return true;
  }
  return false;
}

function resolveArchiveOrigin(
  outlet: ParsedRetailOutlet,
  previous: ExtendedSnapshot,
): { sourceSha256: string; capturedAt: string } {
  if (outlet.provenance?.sourceSha256) {
    return {
      sourceSha256: outlet.provenance.sourceSha256,
      capturedAt: outlet.provenance.importedAt,
    };
  }
  const blockProvenance = previous.blocks?.blockProvenance?.retailOutlets;
  return {
    sourceSha256: blockProvenance?.sourceSha256 ?? previous.sourceSha256,
    capturedAt: blockProvenance?.importedAt ?? previous.importedAt,
  };
}

function appendOutletsToHistoryByOrigin(
  history: RetailOutletHistoryEntry[],
  outlets: ParsedRetailOutlet[],
  previous: ExtendedSnapshot,
  archivedAt: string,
): void {
  const grouped = new Map<
    string,
    { sourceSha256: string; capturedAt: string; retailOutlets: ParsedRetailOutlet[] }
  >();
  for (const outlet of outlets) {
    const origin = resolveArchiveOrigin(outlet, previous);
    const key = `${origin.sourceSha256}\0${origin.capturedAt}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.retailOutlets.push(outlet);
      continue;
    }
    grouped.set(key, {
      sourceSha256: origin.sourceSha256,
      capturedAt: origin.capturedAt,
      retailOutlets: [outlet],
    });
  }
  for (const entry of grouped.values()) {
    history.push({
      sourceSha256: entry.sourceSha256,
      capturedAt: entry.capturedAt,
      archivedAt,
      retailOutlets: entry.retailOutlets,
    });
  }
}

function appendHistoryWhenBusinessChanged(
  previous: ExtendedSnapshot | null,
  nextOutlets: ParsedRetailOutlet[],
  baseHistory: RetailOutletHistoryEntry[],
  mergeHistoryEntries: RetailOutletHistoryEntry[],
  archivedAt: string,
): RetailOutletHistoryEntry[] {
  const history = [...baseHistory];
  const previousCurrent = previous?.currentRetailOutlets ?? [];
  if (previousCurrent.length === 0) {
    return history;
  }
  if (
    extendedBusinessDataEqual(previous, {
      ...previous!,
      currentRetailOutlets: nextOutlets,
    })
  ) {
    return history;
  }
  if (!previous) {
    return history;
  }

  const outletsToArchive = previousCurrent.filter((previousOutlet) => {
    if (outletAlreadyArchivedInMerge(previousOutlet, mergeHistoryEntries)) {
      return false;
    }
    const nextOutlet = findNextOutletForHistory(previousOutlet, nextOutlets);
    return outletHistoryStateChanged(previousOutlet, nextOutlet);
  });

  const orderOnlyChange =
    outletsToArchive.length === 0 &&
    previousCurrent.length === nextOutlets.length &&
    previousCurrent.length > 0 &&
    previousCurrent.every((previousOutlet) => {
      const nextOutlet = findNextOutletForHistory(previousOutlet, nextOutlets);
      return nextOutlet && outletsAreIdentical(previousOutlet, nextOutlet);
    });

  if (outletsToArchive.length === 0 && !orderOnlyChange) {
    return history;
  }

  appendOutletsToHistoryByOrigin(
    history,
    orderOnlyChange ? previousCurrent : outletsToArchive,
    previous,
    archivedAt,
  );
  return history;
}

const BLOCK_PROVENANCE_KEYS = [
  "holding",
  "regionalManager",
  "hardwareManager",
  "headOfSales",
  "retailOutlets",
] as const satisfies ReadonlyArray<keyof ExtendedBlockFreshness>;

function buildBlockProvenanceEntry(
  freshness: ExtendedBlockFreshness[keyof ExtendedBlockFreshness],
  previous: ExtendedSnapshot | null,
  key: keyof ExtendedBlockProvenance,
  sourceSha256: string,
  importedAt: string,
): ExtendedBlockProvenanceEntry {
  if (freshness === "preserved_from_previous" && previous) {
    const previousEntry = previous.blocks?.blockProvenance?.[key];
    if (previousEntry) {
      return {
        freshness: "preserved_from_previous",
        sourceSha256: previousEntry.sourceSha256,
        importedAt: previousEntry.importedAt,
      };
    }
    return {
      freshness: "preserved_from_previous",
      sourceSha256: previous.sourceSha256,
      importedAt: previous.importedAt,
    };
  }
  return {
    freshness,
    sourceSha256,
    importedAt,
  };
}

function buildBlockProvenance(
  blockFreshness: ExtendedBlockFreshness,
  previous: ExtendedSnapshot | null,
  sourceSha256: string,
  importedAt: string,
): ExtendedBlockProvenance {
  const provenance = {} as ExtendedBlockProvenance;
  for (const key of BLOCK_PROVENANCE_KEYS) {
    provenance[key] = buildBlockProvenanceEntry(
      blockFreshness[key],
      previous,
      key,
      sourceSha256,
      importedAt,
    );
  }
  return provenance;
}

export function summarizeRowFreshnessFromProvenance(
  blockProvenance: ExtendedBlockProvenance,
): "current" | "preserved_from_previous" | "not_provided_in_snapshot" {
  return summarizeRowFreshness({
    holding: blockProvenance.holding.freshness,
    regionalManager: blockProvenance.regionalManager.freshness,
    hardwareManager: blockProvenance.hardwareManager.freshness,
    headOfSales: blockProvenance.headOfSales.freshness,
    retailOutlets: blockProvenance.retailOutlets.freshness,
  });
}

function buildBlockFreshness(
  presence: ExtendedRecordFieldPresence,
  hasPrevious: boolean,
): NonNullable<ExtendedSnapshotBlocks["blockFreshness"]> {
  return {
    holding: blockFreshnessForPresence(presence.holding, hasPrevious),
    regionalManager: blockFreshnessForPresence(presence.regionalManager, hasPrevious),
    hardwareManager: blockFreshnessForPresence(presence.hardwareManager, hasPrevious),
    headOfSales: blockFreshnessForPresence(presence.headOfSales, hasPrevious),
    retailOutlets: blockFreshnessForPresence(presence.retailOutlets, hasPrevious),
  };
}

export function summarizeRowFreshness(
  blockFreshness: NonNullable<ExtendedSnapshotBlocks["blockFreshness"]>,
): "current" | "preserved_from_previous" | "not_provided_in_snapshot" {
  const values = Object.values(blockFreshness);
  if (values.every((value) => value === "current")) {
    return "current";
  }
  if (values.every((value) => value === "not_provided_in_snapshot")) {
    return "not_provided_in_snapshot";
  }
  if (values.every((value) => value === "preserved_from_previous")) {
    return "preserved_from_previous";
  }
  if (values.some((value) => value === "preserved_from_previous")) {
    return "preserved_from_previous";
  }
  return "not_provided_in_snapshot";
}

function mergeHoldingLinkForSnapshot(
  record: ParsedExtendedClientRecord,
  previous: ExtendedSnapshot | null,
): ExtendedSnapshotHoldingLink {
  if (record.holdingLinkState === "unresolved") {
    return { state: "unresolved", pendingGuid: record.guid_holding };
  }
  if (record.holdingLinkState === "resolved") {
    return { state: "resolved", pendingGuid: null };
  }
  if (record.holdingLinkState === "none") {
    return { state: "none", pendingGuid: null };
  }
  return previous?.holdingLink ?? { state: "none", pendingGuid: null };
}

function mergeClientManagerRosterState(
  record: ParsedExtendedClientRecord,
  previous: ExtendedSnapshot | null,
): ClientManagerRosterState {
  if (record.managerRosterState !== "roster_not_loaded") {
    return record.managerRosterState;
  }
  return previous?.clientManagerRosterState ?? "roster_not_loaded";
}

export function buildExtendedSnapshotJson(
  record: ParsedExtendedClientRecord,
  previousSnapshot: unknown,
  sourceSha256: string,
  importedAt: string,
  options: { contractVerified: boolean },
): ExtendedSnapshot {
  const previous = readExistingSnapshot(previousSnapshot);
  const hasPrevious = previous !== null;
  const isNewClient = !hasPrevious;

  const isHolding = mergeHoldingFlag(record.isHolding, record.fieldPresence.holding, previous?.isHolding);
  const holdingLink = mergeHoldingLinkForSnapshot(record, previous);
  const clientManagerRosterState = mergeClientManagerRosterState(record, previous);
  const regionalManager = mergeManagerField(
    record.regionalManager,
    record.fieldPresence.regionalManager,
    previous?.regionalManager,
    isNewClient,
  );
  const hardwareManager = mergeManagerField(
    record.hardwareManager,
    record.fieldPresence.hardwareManager,
    previous?.hardwareManager,
    isNewClient,
  );
  const headOfSales = mergeManagerField(
    record.headOfSales,
    record.fieldPresence.headOfSales,
    previous?.headOfSales,
    isNewClient,
  );
  const commercial = mergeCommercialFields(record.commercial, readSnapshotCommercial(previous) ?? undefined);
  const outletMerge = mergeRetailOutletsWithIdentity(
    record.retailOutlets,
    record.fieldPresence.retailOutlets,
    previous?.currentRetailOutlets,
    { sourceSha256, importedAt },
  );
  const currentRetailOutlets = outletMerge.outlets;
  const retailOutletHistory = [
    ...(previous?.retailOutletHistory ?? []),
    ...outletMerge.historyEntries,
  ];

  const businessChanged = !extendedBusinessDataEqual(previous, {
    formatVersion: "extended_v1",
    sourceSha256: previous?.sourceSha256 ?? sourceSha256,
    importedAt: previous?.importedAt ?? importedAt,
    isHolding,
    holdingLink,
    clientManagerRosterState,
    regionalManager,
    hardwareManager,
    headOfSales,
    commercial,
    currentRetailOutlets,
    retailOutletHistory,
    blocks: previous?.blocks ?? {
      clientExtendedReady: false,
      outletNormalizedReady: false,
    },
  });

  const blockFreshness = {
    ...buildBlockFreshness(record.fieldPresence, hasPrevious),
    retailOutlets: deriveRetailOutletsBlockFreshness(
      currentRetailOutlets,
      record.fieldPresence.retailOutlets,
      hasPrevious,
    ),
  };
  const blockProvenance = buildBlockProvenance(blockFreshness, previous, sourceSha256, importedAt);
  const effectiveImportedAt =
    previous && !businessChanged ? previous.importedAt : importedAt;

  return {
    formatVersion: "extended_v1",
    sourceSha256,
    importedAt: effectiveImportedAt,
    isHolding,
    holdingLink,
    clientManagerRosterState,
    regionalManager,
    hardwareManager,
    headOfSales,
    commercial,
    currentRetailOutlets,
    retailOutletHistory: appendHistoryWhenBusinessChanged(
      previous,
      currentRetailOutlets,
      retailOutletHistory,
      outletMerge.historyEntries,
      importedAt,
    ),
    blocks: {
      clientExtendedReady: options.contractVerified,
      outletNormalizedReady: false,
      clientExtendedBlockedReason: options.contractVerified ? null : "awaiting_live_json_verification",
      blockFreshness,
      blockProvenance,
    },
  };
}

export { extendedBusinessDataEqual };

export function isExtendedApplyPayload(payload: ValidatedClientsPayload): boolean {
  return payload.sourceFormat === "extended_v1" && Array.isArray(payload.extendedRecords);
}

export function isExtendedContractVerified(payload: ValidatedClientsPayload): boolean {
  return payload.extendedContractVerification === "synthetic_confirmed";
}

export function resolveExtendedRecordsForApply(
  payload: ValidatedClientsPayload,
): Map<string, ParsedExtendedClientRecord> {
  const map = new Map<string, ParsedExtendedClientRecord>();
  if (!isExtendedApplyPayload(payload)) {
    return map;
  }
  for (const record of payload.extendedRecords!) {
    if (
      record.recordFormat !== "extended_v1" &&
      !record.hasExtendedManagerFields &&
      !hasAnyCommercialField(record.commercial)
    ) {
      continue;
    }
    map.set(record.guid_client, record);
  }
  return map;
}

export function summarizeExtendedFreshness(snapshot: ExtendedSnapshot | null): {
  extendedFreshnessState: "current" | "preserved_from_previous" | "not_provided_in_snapshot";
} {
  if (snapshot?.blocks.blockProvenance) {
    return { extendedFreshnessState: summarizeRowFreshnessFromProvenance(snapshot.blocks.blockProvenance) };
  }
  if (snapshot?.blocks.blockFreshness) {
    return { extendedFreshnessState: summarizeRowFreshness(snapshot.blocks.blockFreshness) };
  }
  return { extendedFreshnessState: "current" };
}

export async function loadExistingExtendedSnapshots(
  client: PoolClient,
): Promise<Map<string, ExistingExtendedRow>> {
  const result = await client.query<ExistingExtendedRow>(
    `
      SELECT
        guid_client::text,
        extended_snapshot,
        extended_source_sha256,
        extended_imported_at
      FROM onec_clients
      WHERE extended_snapshot IS NOT NULL
         OR extended_format_version IS NOT NULL
    `,
  );
  const map = new Map<string, ExistingExtendedRow>();
  for (const row of result.rows) {
    map.set(row.guid_client, row);
  }
  return map;
}

export function readExtendedSnapshot(snapshot: unknown): ExtendedSnapshot | null {
  return readExistingSnapshot(snapshot);
}
