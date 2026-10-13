import type { AccessContext } from "../../access/types";
import { ropLegacyTeamEmployeesSubquery } from "../../access/rop-read-scope";

export type V3ScopeSql = { clause: string; params: unknown[] };

/** Deny-all and employee-link gates first — aligned with existing access policy ordering. */
export function v3BaseAccessGate(context: AccessContext): V3ScopeSql | null {
  if (context.explicitlyDeniedAll) {
    return { clause: "FALSE", params: [] };
  }
  if (context.fullClientBase) {
    return { clause: "TRUE", params: [] };
  }
  if (context.employeeLinkConflict || !context.hasEmployeeLink) {
    return { clause: "FALSE", params: [] };
  }
  if (!context.hasScopedClientAccess) {
    return { clause: "FALSE", params: [] };
  }
  return null;
}

function managerAssignmentClause(alias: string, employeeParam: string): string {
  return `(${alias}.managers->>'guidManager')::uuid = ${employeeParam}::uuid`;
}

function regionalAssignmentClause(alias: string, employeeParam: string): string {
  return `(${alias}.managers->>'guidRegionalManager')::uuid = ${employeeParam}::uuid`;
}

function hardwareAssignmentClause(alias: string, employeeParam: string): string {
  return `(${alias}.managers->>'guidHardwareManager')::uuid = ${employeeParam}::uuid`;
}

/** Legal entity or retail row visibility from v3 assignment JSON. */
export function v3EntityAssignmentScope(context: AccessContext, alias: string): V3ScopeSql {
  const gate = v3BaseAccessGate(context);
  if (gate) {
    return gate;
  }

  const employeeId = context.employeeId!;
  const userId = context.userId;

  switch (context.role) {
    case "manager":
      return {
        clause: managerAssignmentClause(alias, "$1"),
        params: [employeeId],
      };
    case "regional_manager":
      return {
        clause: regionalAssignmentClause(alias, "$1"),
        params: [employeeId],
      };
    case "rop": {
      const teamEmployees = ropLegacyTeamEmployeesSubquery("$1", "$2");
      return {
        clause: `(${alias}.managers->>'guidManager')::uuid IN (${teamEmployees})`,
        params: [userId, employeeId],
      };
    }
    default:
      return { clause: "FALSE", params: [] };
  }
}

/** Holding visible when at least one legal or retail member is visible under the same rules. */
export function v3HoldingVisibilityScope(context: AccessContext, holdingAlias: string): V3ScopeSql {
  const gate = v3BaseAccessGate(context);
  if (gate) {
    return gate;
  }

  const legalScope = v3EntityAssignmentScope(context, "le");
  const retailScope = v3EntityAssignmentScope(context, "ro");
  const params = [...legalScope.params];
  let retailClause = retailScope.clause;
  if (retailScope.params.length > 0) {
    const offset = legalScope.params.length;
    retailClause = retailClause.replace(/\$(\d+)/g, (_m, index) => `$${Number(index) + offset}`);
    params.push(...retailScope.params);
  }

  return {
    clause: `EXISTS (
      SELECT 1 FROM onec_v3_legal_entities le
      WHERE le.guid_holding = ${holdingAlias}.guid_holding AND (${legalScope.clause})
    ) OR EXISTS (
      SELECT 1 FROM onec_v3_retail_outlets ro
      WHERE ro.guid_holding = ${holdingAlias}.guid_holding AND (${retailClause})
    )`,
    params,
  };
}
