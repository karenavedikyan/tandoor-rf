import { combineScopeAndFilter } from "../../access/combine-filters";
import type { SqlFilter } from "../query";
import type { ClientsListQuery } from "../query";
import {
  clientAssignedToRopClause,
  clientHardwareGuidSql,
  clientRegionalGuidSql,
  outletAssignedToRopClause,
  outletHardwareGuidSql,
  outletManagerGuidSql,
  outletRegionalGuidSql,
  outletStoreGuidSql,
  RETAIL_OUTLETS_JSON,
} from "./assignment-sql";

export type ResponsibleAssignmentKind = "manager" | "regional" | "hardware";

export function parseResponsibleAssignmentKind(
  raw: unknown,
): ResponsibleAssignmentKind | undefined | null {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  if (value === "manager" || value === "regional" || value === "hardware") {
    return value;
  }
  return null;
}

export function parseBranchPortfolio(raw: unknown): "clients" | "outlets" | undefined | null {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  if (value === "clients" || value === "outlets") {
    return value;
  }
  return null;
}

export function resolveResponsibleSelection(input: ClientsListQuery): {
  kind: ResponsibleAssignmentKind;
  employeeGuid: string;
} | null {
  const kind = input.responsibleKind ?? (input.managerId ? "manager" : undefined);
  if (!kind) {
    return null;
  }
  if (kind === "manager" && input.managerId) {
    return { kind, employeeGuid: input.managerId.toLowerCase() };
  }
  if (kind === "regional" && input.regionalManagerId) {
    return { kind, employeeGuid: input.regionalManagerId.toLowerCase() };
  }
  if (kind === "hardware" && input.hardwareManagerId) {
    return { kind, employeeGuid: input.hardwareManagerId.toLowerCase() };
  }
  if (input.managerId && !input.responsibleKind) {
    return { kind: "manager", employeeGuid: input.managerId.toLowerCase() };
  }
  return null;
}

export function buildOrgRopAssignedClientsFilter(ropEmployeeGuid: string): SqlFilter {
  return {
    whereSql: `WHERE ${clientAssignedToRopClause("$1")}`,
    params: [ropEmployeeGuid.toLowerCase()],
  };
}

export function buildOrgRopAssignedOutletsFilter(ropEmployeeGuid: string): SqlFilter {
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc");
  return {
    whereSql: `WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${outletsJson}) outlet(elem)
      WHERE ${outletStoreGuidSql("outlet.elem")} = lower(ro.guid_store::text)
        AND ${outletAssignedToRopClause("$1", "outlet.elem")}
    )`,
    params: [ropEmployeeGuid.toLowerCase()],
  };
}

function responsibleClientsClause(
  ropParamSql: string,
  employeeParamSql: string,
  kind: ResponsibleAssignmentKind,
  clientAlias = "onec_clients",
): string {
  const ropAssigned = clientAssignedToRopClause(ropParamSql, clientAlias);
  if (kind === "manager") {
    return `(${ropAssigned} AND lower(${clientAlias}.guid_manager::text) = lower(${employeeParamSql}::text))`;
  }
  if (kind === "regional") {
    return `(${ropAssigned} AND ${clientRegionalGuidSql(clientAlias)} = lower(${employeeParamSql}::text))`;
  }
  return `(${ropAssigned} AND ${clientHardwareGuidSql(clientAlias)} = lower(${employeeParamSql}::text))`;
}

function responsibleOutletsClause(
  ropParamSql: string,
  employeeParamSql: string,
  kind: ResponsibleAssignmentKind,
): string {
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", "oc");
  const employeeMatch =
    kind === "manager"
      ? `${outletManagerGuidSql("outlet.elem")} = lower(${employeeParamSql}::text)`
      : kind === "regional"
        ? `${outletRegionalGuidSql("outlet.elem")} = lower(${employeeParamSql}::text)`
        : `${outletHardwareGuidSql("outlet.elem")} = lower(${employeeParamSql}::text)`;
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(${outletsJson}) outlet(elem)
    WHERE ${outletStoreGuidSql("outlet.elem")} = lower(ro.guid_store::text)
      AND ${outletAssignedToRopClause(ropParamSql, "outlet.elem")}
      AND ${employeeMatch}
  )`;
}

export function buildOrgResponsibleClientsFilter(
  ropEmployeeGuid: string,
  employeeGuid: string,
  kind: ResponsibleAssignmentKind,
): SqlFilter {
  return {
    whereSql: `WHERE ${responsibleClientsClause("$1", "$2", kind)}`,
    params: [ropEmployeeGuid.toLowerCase(), employeeGuid.toLowerCase()],
  };
}

export function buildOrgResponsibleOutletsFilter(
  ropEmployeeGuid: string,
  employeeGuid: string,
  kind: ResponsibleAssignmentKind,
): SqlFilter {
  return {
    whereSql: `WHERE ${responsibleOutletsClause("$1", "$2", kind)}`,
    params: [ropEmployeeGuid.toLowerCase(), employeeGuid.toLowerCase()],
  };
}

export function applyOrgTeamsClientFilter(
  userFilter: SqlFilter,
  input: ClientsListQuery,
  ropEmployeeGuid: string,
): SqlFilter {
  const responsible = resolveResponsibleSelection(input);
  if (responsible) {
    return combineScopeAndFilter(
      userFilter,
      buildOrgResponsibleClientsFilter(ropEmployeeGuid, responsible.employeeGuid, responsible.kind),
    );
  }
  if (input.branchPortfolio === "outlets") {
    return { whereSql: "WHERE FALSE", params: [] };
  }
  return combineScopeAndFilter(userFilter, buildOrgRopAssignedClientsFilter(ropEmployeeGuid));
}

export function applyOrgTeamsOutletFilter(
  userFilter: SqlFilter,
  input: ClientsListQuery,
  ropEmployeeGuid: string,
): SqlFilter {
  const responsible = resolveResponsibleSelection(input);
  if (responsible) {
    return combineScopeAndFilter(
      userFilter,
      buildOrgResponsibleOutletsFilter(ropEmployeeGuid, responsible.employeeGuid, responsible.kind),
    );
  }
  if (input.branchPortfolio === "clients") {
    return { whereSql: "WHERE FALSE", params: [] };
  }
  return combineScopeAndFilter(userFilter, buildOrgRopAssignedOutletsFilter(ropEmployeeGuid));
}
