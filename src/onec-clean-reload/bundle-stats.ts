import type { ValidatedClientsPayload } from "../onec-clients/types";
import type { WholesaleEmployeeRoster } from "../onec-clients/employee-roster";
import type { BundleCompositionStats } from "./types";

export function computeBundleCompositionStats(input: {
  payload: ValidatedClientsPayload;
  employeeRoster: WholesaleEmployeeRoster;
}): BundleCompositionStats {
  const managerGuidsWithClients = new Set<string>();
  let retailOutletsOpen = 0;
  let retailOutletsClosed = 0;
  let retailOutletsWithoutGuidStore = 0;
  let assignmentsOutsideRoster = 0;
  let clientsWithoutManager = 0;
  let unresolvedHoldingLinks = 0;

  const extendedByGuid = new Map(
    (input.payload.extendedRecords ?? []).map((record) => [record.guid_client, record]),
  );

  for (const record of input.payload.records) {
    const managerGuid = record.guid_manager?.toLowerCase();
    if (!managerGuid) {
      clientsWithoutManager += 1;
    } else {
      managerGuidsWithClients.add(managerGuid);
      if (!input.employeeRoster.wholesaleGuids.has(managerGuid)) {
        assignmentsOutsideRoster += 1;
      }
    }

    const extended = extendedByGuid.get(record.guid_client);
    if (extended?.holdingLinkState === "unresolved") {
      unresolvedHoldingLinks += 1;
    }

    for (const outlet of extended?.retailOutlets ?? []) {
      if (!outlet.guidStore) {
        retailOutletsWithoutGuidStore += 1;
        continue;
      }
      if (outlet.closureStatus === "closed" || outlet.closed === true) {
        retailOutletsClosed += 1;
      } else if (outlet.closureStatus === "open" || outlet.closed === false) {
        retailOutletsOpen += 1;
      }
    }
  }

  let employeesWithoutClients = 0;
  for (const guid of input.employeeRoster.wholesaleGuids) {
    if (!managerGuidsWithClients.has(guid)) {
      employeesWithoutClients += 1;
    }
  }

  return {
    clientsRecordCount: input.payload.recordCount,
    retailOutletsOpen,
    retailOutletsClosed,
    retailOutletsWithoutGuidStore,
    wholesaleEmployeeCount: input.employeeRoster.wholesaleCount,
    employeesWithoutClients,
    assignmentsOutsideRoster,
    clientsWithoutManager,
    unresolvedHoldingLinks,
  };
}
