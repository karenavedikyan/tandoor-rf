import type { SqlFilter } from "../query";
import {
  clientAssignedToRopClause,
  managerInRopBranchClause,
  regionalInRopBranchClause,
  ropPortfolioClause,
} from "./assignment-sql";

export function buildOrgRopBranchFilter(ropEmployeeGuid: string): SqlFilter {
  return {
    whereSql: `WHERE ${ropPortfolioClause("$1")}`,
    params: [ropEmployeeGuid.toLowerCase()],
  };
}

export function buildOrgManagerInBranchFilter(
  ropEmployeeGuid: string,
  managerEmployeeGuid: string,
): SqlFilter {
  return {
    whereSql: `WHERE ${managerInRopBranchClause("$1", "$2")}`,
    params: [ropEmployeeGuid.toLowerCase(), managerEmployeeGuid.toLowerCase()],
  };
}

export function buildOrgRegionalInBranchFilter(
  ropEmployeeGuid: string,
  regionalEmployeeGuid: string,
): SqlFilter {
  return {
    whereSql: `WHERE ${regionalInRopBranchClause("$1", "$2")}`,
    params: [ropEmployeeGuid.toLowerCase(), regionalEmployeeGuid.toLowerCase()],
  };
}

export function buildHeadOfSalesClientFilter(headOfSalesGuid: string): SqlFilter {
  return {
    whereSql: `WHERE ${clientAssignedToRopClause("$1")}`,
    params: [headOfSalesGuid.toLowerCase()],
  };
}
