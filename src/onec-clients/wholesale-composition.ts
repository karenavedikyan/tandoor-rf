import type { HoldingLinkValidationPolicy } from "./holding-link-policy";
import type { ParsedExtendedClientRecord, ParsedManagerRef } from "./extended-types";
import type { ValidatedClientsPayload } from "./types";

export type WholesaleCompositionMode = "standard" | "replacement_prep";

export type WholesaleCompositionClientBucket = {
  count: number;
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
  linkedAccountCount: number;
  confirmedOutletCount: number;
  bitrixTaskLinkCount: number;
  deletionBlockedReasons: string[];
};

export type WholesaleCompositionPrepReport = {
  mode: "replacement_prep";
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  employeeRosterLoaded: boolean;
  wholesaleEmployeeCount: number | null;
  incomingRecordCount: number;
  existingRecordCount: number;
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
    count: number;
    samples: ExcludedRecordDependencySummary[];
    truncated: boolean;
  };
  operationBlockers: string[];
  writesBusinessData: false;
  performsDeletion: false;
};

const MAX_SAMPLE_GUIDS = 25;
const MAX_SAMPLE_ROWS = 20;

function sampleGuids(guids: string[]): WholesaleCompositionClientBucket {
  return {
    count: guids.length,
    sampleGuids: guids.slice(0, MAX_SAMPLE_GUIDS),
    truncated: guids.length > MAX_SAMPLE_GUIDS,
  };
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
  clientGuids: ReadonlySet<string>;
  linkedAccountsByClient: ReadonlyMap<string, number>;
  confirmedOutletsByClient: ReadonlyMap<string, number>;
  bitrixTaskLinksByClient: ReadonlyMap<string, number>;
};

export function buildWholesaleCompositionPrepReport(input: {
  payload: ValidatedClientsPayload;
  holdingLinkPolicy: HoldingLinkValidationPolicy;
  employeeRosterLoaded: boolean;
  wholesaleEmployeeCount: number | null;
  existing: ExistingCompositionContext;
}): WholesaleCompositionPrepReport {
  const extendedRecords = input.payload.extendedRecords ?? [];
  const incomingGuids = extendedRecords.map((record) => record.guid_client);
  const incomingSet = new Set(incomingGuids);

  const toAdd = incomingGuids.filter((guid) => !input.existing.clientGuids.has(guid));
  const toKeep = incomingGuids.filter((guid) => input.existing.clientGuids.has(guid));
  const toExclude = [...input.existing.clientGuids].filter((guid) => !incomingSet.has(guid));

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
    const linkedAccountCount = input.existing.linkedAccountsByClient.get(guid) ?? 0;
    const confirmedOutletCount = input.existing.confirmedOutletsByClient.get(guid) ?? 0;
    const bitrixTaskLinkCount = input.existing.bitrixTaskLinksByClient.get(guid) ?? 0;
    const deletionBlockedReasons: string[] = [
      "automatic_deletion_disabled_in_replacement_prep",
    ];
    if (linkedAccountCount > 0) {
      deletionBlockedReasons.push("linked_user_accounts_present");
    }
    if (confirmedOutletCount > 0) {
      deletionBlockedReasons.push("confirmed_outlets_present");
    }
    if (bitrixTaskLinkCount > 0) {
      deletionBlockedReasons.push("bitrix_task_links_present");
    }

    if (dependencySamples.length < MAX_SAMPLE_ROWS) {
      dependencySamples.push({
        guidClient: guid,
        linkedAccountCount,
        confirmedOutletCount,
        bitrixTaskLinkCount,
        deletionBlockedReasons,
      });
    }
  }

  const operationBlockers: string[] = [];
  if (toExclude.length > 0) {
    operationBlockers.push("excluded_records_require_separate_cleanup_approval");
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
    wholesaleEmployeeCount: input.wholesaleEmployeeCount,
    incomingRecordCount: incomingGuids.length,
    existingRecordCount: input.existing.clientGuids.size,
    clientsToAdd: sampleGuids(toAdd),
    clientsToKeep: sampleGuids(toKeep),
    clientsToExclude: sampleGuids(toExclude),
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
      count: toExclude.length,
      samples: dependencySamples,
      truncated: toExclude.length > dependencySamples.length,
    },
    operationBlockers,
    writesBusinessData: false,
    performsDeletion: false,
  };
}
