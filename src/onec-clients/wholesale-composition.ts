import type { HoldingLinkValidationPolicy } from "./holding-link-policy";
import type { ParsedExtendedClientRecord, ParsedManagerRef } from "./extended-types";
import type { ValidatedClientsPayload } from "./types";

export type WholesaleCompositionMode = "standard" | "replacement_prep";

export type WholesaleCompositionClientBucket = {
  count: number | null;
  sampleGuids: string[];
  truncated: boolean;
};

export type UnresolvedHoldingLinkSample = {
  guidClient: string;
  guidHolding: string;
};

export type OutOfRosterManagerSample = {
  guid: string;
  field: string;
  clientGuid: string;
};

export type ExcludedRecordDependencySummary = {
  guidClient: string;
  activeAccessGrantCount: number | null;
  linkedEmployeeAccountCount: number | null;
  confirmedOutletCount: number | null;
  bitrixTaskCount: number | null;
  deletionBlockedReasons: string[];
};

export type WholesaleCompositionPrepReport = {
  mode: "replacement_prep";
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  employeeRosterLoaded: boolean;
  employeeRosterSourceSha256: string | null;
  wholesaleEmployeeCount: number | null;
  baselineAvailability: "loaded" | "unavailable";
  incomingRecordCount: number;
  existingRecordCount: number | null;
  clientsToAdd: WholesaleCompositionClientBucket;
  clientsToKeep: WholesaleCompositionClientBucket;
  clientsToExclude: WholesaleCompositionClientBucket;
  unresolvedHoldingLinks: {
    count: number;
    samples: UnresolvedHoldingLinkSample[];
    truncated: boolean;
  };
  outOfRosterManagers: {
    count: number;
    samples: OutOfRosterManagerSample[];
    truncated: boolean;
  };
  excludedDependencies: {
    count: number | null;
    samples: ExcludedRecordDependencySummary[];
    truncated: boolean;
  };
  baselineTransition: {
    excludedFromIncomingBaseline: number | null;
    interpretation: "agreed_baseline_change_not_restore_requirement";
  };
  operationBlockers: string[];
  applyAllowed: false;
  writesBusinessData: false;
  performsDeletion: false;
};

export function rejectWholesaleCompositionPrepApply(input: {
  wholesaleCompositionPrep?: boolean;
  payload: ValidatedClientsPayload;
}): { code: "APPLY_BLOCKED"; message: string } | null {
  if (
    input.wholesaleCompositionPrep === true ||
    input.payload.wholesaleCompositionMode === "replacement_prep"
  ) {
    return {
      code: "APPLY_BLOCKED",
      message:
        "Wholesale composition prep is dry-run only. Apply the new wholesale baseline requires a separate approved procedure.",
    };
  }
  return null;
}

const MAX_SAMPLE_GUIDS = 25;
const MAX_SAMPLE_ROWS = 20;

function sampleGuids(guids: string[]): WholesaleCompositionClientBucket {
  return {
    count: guids.length,
    sampleGuids: guids.slice(0, MAX_SAMPLE_GUIDS),
    truncated: guids.length > MAX_SAMPLE_GUIDS,
  };
}

function emptyBucket(): WholesaleCompositionClientBucket {
  return { count: null, sampleGuids: [], truncated: false };
}

function incomingClientGuids(payload: ValidatedClientsPayload): string[] {
  if (payload.extendedRecords && payload.extendedRecords.length > 0) {
    return payload.extendedRecords.map((record) => record.guid_client);
  }
  return payload.records.map((record) => record.guid_client);
}

function collectManagerRefs(record: ParsedExtendedClientRecord): Array<{ field: string; ref: ParsedManagerRef }> {
  const refs: Array<{ field: string; ref: ParsedManagerRef }> = [
    { field: "guid_regional_manager", ref: record.regionalManager },
    { field: "guid_hardware_manager", ref: record.hardwareManager },
    { field: "guid_head_of_the_sales_department", ref: record.headOfSales },
  ];
  for (const outlet of record.retailOutlets) {
    refs.push(
      { field: "retail_outlets.managers.guid_manager", ref: outlet.managers.manager },
      { field: "retail_outlets.managers.guid_regional_manager", ref: outlet.managers.regionalManager },
      { field: "retail_outlets.managers.guid_hardware_manager", ref: outlet.managers.hardwareManager },
      {
        field: "retail_outlets.managers.guid_head_of_the_sales_department",
        ref: outlet.managers.headOfSales,
      },
    );
  }
  return refs;
}

export type ExistingCompositionContext = {
  baselineAvailability: "loaded" | "unavailable";
  clientGuids: ReadonlySet<string>;
  activeAccessGrantCountByClient: ReadonlyMap<string, number>;
  linkedEmployeeAccountCountByClient: ReadonlyMap<string, number>;
  confirmedOutletsByClient: ReadonlyMap<string, number>;
  bitrixTaskCountByClient: ReadonlyMap<string, number>;
};

function dependencyCount(
  map: ReadonlyMap<string, number>,
  guid: string,
  baselineLoaded: boolean,
): number | null {
  if (!baselineLoaded) {
    return null;
  }
  return map.get(guid.toLowerCase()) ?? 0;
}

export function buildWholesaleCompositionPrepReport(input: {
  payload: ValidatedClientsPayload;
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  employeeRosterLoaded: boolean;
  employeeRosterSourceSha256: string | null;
  wholesaleEmployeeCount: number | null;
  existing: ExistingCompositionContext;
}): WholesaleCompositionPrepReport {
  const baselineLoaded = input.existing.baselineAvailability === "loaded";
  const incomingGuids = incomingClientGuids(input.payload);
  const incomingSet = new Set(incomingGuids.map((guid) => guid.toLowerCase()));

  const toAdd = baselineLoaded
    ? incomingGuids.filter((guid) => !input.existing.clientGuids.has(guid.toLowerCase()))
    : [];
  const toKeep = baselineLoaded
    ? incomingGuids.filter((guid) => input.existing.clientGuids.has(guid.toLowerCase()))
    : [];
  const toExclude = baselineLoaded
    ? [...input.existing.clientGuids].filter((guid) => !incomingSet.has(guid))
    : [];

  const extendedRecords = input.payload.extendedRecords ?? [];

  const unresolvedSamples: UnresolvedHoldingLinkSample[] = [];
  for (const record of extendedRecords) {
    if (record.holdingLinkState !== "unresolved" || !record.guid_holding) {
      continue;
    }
    if (unresolvedSamples.length >= MAX_SAMPLE_ROWS) {
      break;
    }
    unresolvedSamples.push({
      guidClient: record.guid_client,
      guidHolding: record.guid_holding,
    });
  }
  const unresolvedCount = extendedRecords.filter(
    (record) => record.holdingLinkState === "unresolved" && record.guid_holding,
  ).length;

  const outOfRosterSamples: OutOfRosterManagerSample[] = [];
  let outOfRosterCount = 0;
  for (const record of extendedRecords) {
    for (const { field, ref } of collectManagerRefs(record)) {
      if (ref.state !== "outside_wholesale_roster" || !ref.guid) {
        continue;
      }
      outOfRosterCount += 1;
      if (outOfRosterSamples.length < MAX_SAMPLE_ROWS) {
        outOfRosterSamples.push({
          guid: ref.guid,
          field,
          clientGuid: record.guid_client,
        });
      }
    }
    if (record.guid_manager && record.managerRosterState === "outside_wholesale_roster") {
      outOfRosterCount += 1;
      if (outOfRosterSamples.length < MAX_SAMPLE_ROWS) {
        outOfRosterSamples.push({
          guid: record.guid_manager,
          field: "guid_manager",
          clientGuid: record.guid_client,
        });
      }
    }
  }

  const dependencySamples: ExcludedRecordDependencySummary[] = [];
  for (const guid of toExclude) {
    const activeAccessGrantCount = dependencyCount(
      input.existing.activeAccessGrantCountByClient,
      guid,
      baselineLoaded,
    );
    const linkedEmployeeAccountCount = dependencyCount(
      input.existing.linkedEmployeeAccountCountByClient,
      guid,
      baselineLoaded,
    );
    const confirmedOutletCount = dependencyCount(
      input.existing.confirmedOutletsByClient,
      guid,
      baselineLoaded,
    );
    const bitrixTaskCount = dependencyCount(input.existing.bitrixTaskCountByClient, guid, baselineLoaded);
    const deletionBlockedReasons: string[] = ["automatic_deletion_disabled_in_replacement_prep"];
    if (activeAccessGrantCount != null && activeAccessGrantCount > 0) {
      deletionBlockedReasons.push("active_access_grants_present");
    }
    if (linkedEmployeeAccountCount != null && linkedEmployeeAccountCount > 0) {
      deletionBlockedReasons.push("linked_employee_accounts_present");
    }
    if (confirmedOutletCount != null && confirmedOutletCount > 0) {
      deletionBlockedReasons.push("confirmed_outlets_present");
    }
    if (bitrixTaskCount != null && bitrixTaskCount > 0) {
      deletionBlockedReasons.push("bitrix_tasks_present");
    }

    if (dependencySamples.length < MAX_SAMPLE_ROWS) {
      dependencySamples.push({
        guidClient: guid,
        activeAccessGrantCount,
        linkedEmployeeAccountCount,
        confirmedOutletCount,
        bitrixTaskCount,
        deletionBlockedReasons,
      });
    }
  }

  const operationBlockers: string[] = [
    "wholesale_composition_prep_is_dry_run_only",
    "baseline_apply_requires_separate_approved_procedure",
  ];
  if (!baselineLoaded) {
    operationBlockers.push("database_baseline_unavailable");
  }
  if (unresolvedCount > 0) {
    operationBlockers.push("unresolved_holding_links_do_not_inherit_access");
  }
  if (outOfRosterCount > 0) {
    operationBlockers.push("out_of_roster_manager_guids_do_not_grant_access");
  }

  return {
    mode: "replacement_prep",
    holdingLinkPolicy: input.holdingLinkPolicy,
    employeeRosterLoaded: input.employeeRosterLoaded,
    employeeRosterSourceSha256: input.employeeRosterSourceSha256,
    wholesaleEmployeeCount: input.wholesaleEmployeeCount,
    baselineAvailability: input.existing.baselineAvailability,
    incomingRecordCount: incomingGuids.length,
    existingRecordCount: baselineLoaded ? input.existing.clientGuids.size : null,
    clientsToAdd: baselineLoaded ? sampleGuids(toAdd) : emptyBucket(),
    clientsToKeep: baselineLoaded ? sampleGuids(toKeep) : emptyBucket(),
    clientsToExclude: baselineLoaded ? sampleGuids(toExclude) : emptyBucket(),
    unresolvedHoldingLinks: {
      count: unresolvedCount,
      samples: unresolvedSamples,
      truncated: unresolvedCount > unresolvedSamples.length,
    },
    outOfRosterManagers: {
      count: outOfRosterCount,
      samples: outOfRosterSamples,
      truncated: outOfRosterCount > outOfRosterSamples.length,
    },
    excludedDependencies: {
      count: baselineLoaded ? toExclude.length : null,
      samples: dependencySamples,
      truncated: baselineLoaded && toExclude.length > dependencySamples.length,
    },
    baselineTransition: {
      excludedFromIncomingBaseline: baselineLoaded ? toExclude.length : null,
      interpretation: "agreed_baseline_change_not_restore_requirement",
    },
    operationBlockers,
    applyAllowed: false,
    writesBusinessData: false,
    performsDeletion: false,
  };
}
