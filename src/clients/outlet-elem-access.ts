import type { AccessContext } from "../access/types";
import { ropLegacyTeamEmployeesSubquery } from "../access/rop-read-scope";
import {
  outletAssignedToRopClause,
  outletHardwareGuidSql,
  outletHeadOfSalesGuidSql,
  outletInheritedFromClientHardwareClause,
  outletInheritedFromClientManagerClause,
  outletInheritedFromClientRopClause,
  outletManagerGuidSql,
  outletRegionalGuidSql,
} from "./org/assignment-sql";
import { outletsJsonArraySql } from "./outlets/scope-sql";

export type OutletElemAccessParams = {
  managerEmployeeParam?: string;
  ropUserParam?: string;
  ropEmployeeParam?: string;
};

/** Whether a snapshot outlet row is visible under Sprint 1 scope rules. */
export function outletElemAccessibleSql(
  context: AccessContext,
  clientAlias: string,
  outletAlias: string,
  params: OutletElemAccessParams,
): string {
  if (context.fullClientBase || context.role === "admin") {
    return "TRUE";
  }

  if (context.role === "manager" && params.managerEmployeeParam) {
    return `(
      ${outletManagerGuidSql(outletAlias)} = lower(${params.managerEmployeeParam}::text)
      OR ${outletHardwareGuidSql(outletAlias)} = lower(${params.managerEmployeeParam}::text)
      OR ${outletInheritedFromClientManagerClause(params.managerEmployeeParam, clientAlias, outletAlias)}
      OR ${outletInheritedFromClientHardwareClause(params.managerEmployeeParam, clientAlias, outletAlias)}
    )`;
  }

  if (context.role === "regional_manager" && params.managerEmployeeParam) {
    return `${outletRegionalGuidSql(outletAlias)} = lower(${params.managerEmployeeParam}::text)`;
  }

  if (context.role === "rop" && params.ropUserParam && params.ropEmployeeParam) {
    const teamEmployees = ropLegacyTeamEmployeesSubquery(params.ropUserParam, params.ropEmployeeParam);
    return `(
      lower(${clientAlias}.guid_manager::text) IN (
        SELECT lower(employee_guid::text) FROM (${teamEmployees}) team
      )
      OR ${outletAssignedToRopClause(params.ropEmployeeParam, outletAlias)}
      OR ${outletInheritedFromClientRopClause(params.ropEmployeeParam, clientAlias, outletAlias)}
      OR lower(coalesce(${outletAlias}->'managers'->'regionalManager'->>'guid', '')) IN (
        SELECT lower(employee_guid::text) FROM (${teamEmployees}) team_reg
      )
    )`;
  }

  return "TRUE";
}

export function scopedOutletJsonArraySql(clientAlias: string): string {
  return outletsJsonArraySql(clientAlias);
}

/** Resolve SQL param placeholders for outlet row accessibility inside EXISTS/CTE. */
export function resolveOutletElemAccessParams(
  context: AccessContext,
  existingParams: unknown[],
): { accessParams: OutletElemAccessParams; extraParams: unknown[] } {
  const extraParams: unknown[] = [];
  const accessParams: OutletElemAccessParams = {};

  function paramRefForValue(value: string, castText: boolean): string {
    const index = existingParams.findIndex(
      (param) => typeof param === "string" && param.toLowerCase() === value.toLowerCase(),
    );
    if (index >= 0) {
      return `$${index + 1}${castText ? "::text" : ""}`;
    }
    extraParams.push(value);
    return `$${existingParams.length + extraParams.length}${castText ? "::text" : ""}`;
  }

  if (
    (context.role === "manager" || context.role === "regional_manager") &&
    context.employeeId
  ) {
    accessParams.managerEmployeeParam = paramRefForValue(
      context.employeeId,
      context.role === "regional_manager",
    );
  }

  if (context.role === "rop" && context.employeeId && context.userId) {
    accessParams.ropUserParam = paramRefForValue(context.userId, false);
    accessParams.ropEmployeeParam = paramRefForValue(context.employeeId, false);
  }

  return { accessParams, extraParams };
}

/** WHERE fragment limiting a snapshot outlet row to the user's accessible outlets. */
export function outletElemAccessibleWhereSql(
  context: AccessContext,
  clientAlias: string,
  outletAlias: string,
  accessParams: OutletElemAccessParams,
): string {
  if (context.fullClientBase || context.role === "admin") {
    return "TRUE";
  }
  return outletElemAccessibleSql(context, clientAlias, outletAlias, accessParams);
}

/** CTE pair: direct client list scope + card/outlet read scope (same bind params when aligned). */
export function buildOptionsDualScopeCte(
  directWhereSql: string,
  cardWhereSql: string,
): string {
  const directClause = directWhereSql ? directWhereSql.replace(/^WHERE\s+/, "") : "";
  const cardClause = cardWhereSql ? cardWhereSql.replace(/^WHERE\s+/, "") : "";
  const directBody = directClause ? `SELECT * FROM onec_clients WHERE ${directClause}` : "SELECT * FROM onec_clients";
  const cardBody = cardClause ? `SELECT * FROM onec_clients WHERE ${cardClause}` : "SELECT * FROM onec_clients";
  return `
    WITH scoped_clients AS (${directBody}),
    scoped_card_clients AS (${cardBody})
  `;
}

/** Lateral join over snapshot outlets limited to accessible rows (Sprint 1 scope). */
export function scopedOutletLateralJoinSql(
  context: AccessContext,
  clientAlias: string,
  baseParams: unknown[],
): { lateralSql: string; whereSql: string; extraParams: unknown[]; outletAlias: string } {
  const outletAlias = "outlet";
  const resolved = resolveOutletElemAccessParams(context, baseParams);
  return {
    lateralSql: `CROSS JOIN LATERAL jsonb_array_elements(${outletsJsonArraySql(clientAlias)}) ${outletAlias}`,
    whereSql: outletElemAccessibleWhereSql(context, clientAlias, outletAlias, resolved.accessParams),
    extraParams: resolved.extraParams,
    outletAlias,
  };
}
