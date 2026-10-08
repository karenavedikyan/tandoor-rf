import type { ClientsListQuery } from "../query";

/** Strip sales/regional/hardware assignment filters when opening a 1C employee portfolio. */
export function withoutOnecPortfolioAssignmentFilters(input: ClientsListQuery): ClientsListQuery {
  if (!input.onecPortfolioEmployeeGuid) {
    return input;
  }
  return {
    ...input,
    managerId: undefined,
    managerIds: undefined,
    clientManagerId: undefined,
    clientManagerIds: undefined,
    outletManagerId: undefined,
    outletManagerIds: undefined,
    responsibleKind: undefined,
    regionalManagerId: undefined,
    regionalManagerIds: undefined,
    hardwareManagerId: undefined,
    hardwareManagerIds: undefined,
    clientRegionalManagerId: undefined,
    clientRegionalManagerIds: undefined,
    outletRegionalManagerId: undefined,
    outletRegionalManagerIds: undefined,
    clientHardwareManagerId: undefined,
    clientHardwareManagerIds: undefined,
    outletHardwareManagerId: undefined,
    outletHardwareManagerIds: undefined,
  };
}

export function resolveOnecPortfolioTargetGuids(
  input: ClientsListQuery,
  teamMemberGuids: string[],
): string[] {
  const employee = input.onecPortfolioEmployeeGuid?.toLowerCase();
  if (!employee) {
    return teamMemberGuids;
  }
  if (!teamMemberGuids.some((guid) => guid.toLowerCase() === employee)) {
    return [];
  }
  return [employee];
}
