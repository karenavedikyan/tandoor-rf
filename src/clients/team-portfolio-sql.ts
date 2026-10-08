import {
  clientHardwareGuidSql,
  clientRegionalGuidSql,
  managerDirectClientListClause,
  managerFullClientReadClause,
  outletHardwareGuidSql,
  outletInheritedFromClientHardwareClause,
  outletInheritedFromClientManagerClause,
  outletManagerGuidSql,
  outletRegionalGuidSql,
  outletStoreGuidSql,
} from "./org/assignment-sql";
import { MANAGER_ROSTER_SCOPE_ALLOWED_SQL } from "../onec-clients/manager-status";

export const RETAIL_OUTLETS_JSON = `
  CASE
    WHEN jsonb_typeof(onec_clients.extended_snapshot->'currentRetailOutlets') = 'array'
      THEN onec_clients.extended_snapshot->'currentRetailOutlets'
    ELSE '[]'::jsonb
  END
`;

export const RETAIL_OUTLETS_JSON_OC = `
  CASE
    WHEN jsonb_typeof(oc.extended_snapshot->'currentRetailOutlets') = 'array'
      THEN oc.extended_snapshot->'currentRetailOutlets'
    ELSE '[]'::jsonb
  END
`;

export function employeePortfolioClause(employeeParamSql: string): string {
  return `(
    ${managerFullClientReadClause(employeeParamSql)}
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
      WHERE lower(coalesce(outlet.elem->'managers'->'regionalManager'->>'guid', '')) = lower(${employeeParamSql}::text)
    )
  )`;
}

export function employeeDirectClientListClause(employeeParamSql: string, clientAlias = "onec_clients"): string {
  return `(
    ${managerDirectClientListClause(employeeParamSql, clientAlias)}
    OR ${clientRegionalGuidSql(clientAlias)} = lower(${employeeParamSql}::text)
  )`;
}

export function employeesDirectClientListClause(arrayParamSql: string, clientAlias = "onec_clients"): string {
  const employeeGuidsSql = `SELECT lower(g::text) FROM unnest(${arrayParamSql}::uuid[]) AS g`;
  const rosterSql = MANAGER_ROSTER_SCOPE_ALLOWED_SQL.replaceAll("onec_clients.", `${clientAlias}.`);
  return `(
    (lower(${clientAlias}.guid_manager::text) = ANY(${employeeGuidsSql}) AND ${rosterSql})
    OR ${clientHardwareGuidSql(clientAlias)} = ANY(${employeeGuidsSql})
    OR ${clientRegionalGuidSql(clientAlias)} = ANY(${employeeGuidsSql})
  )`;
}

export function employeeAccessibleOutletExistsClause(
  employeeParamSql: string,
  storeAlias: string,
  clientAlias: string,
): string {
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias);
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(${outletsJson}) outlet(elem)
    WHERE ${outletStoreGuidSql("outlet.elem")} = lower(${storeAlias}.guid_store::text)
      AND (
        ${outletManagerGuidSql("outlet.elem")} = lower(${employeeParamSql}::text)
        OR ${outletHardwareGuidSql("outlet.elem")} = lower(${employeeParamSql}::text)
        OR ${outletRegionalGuidSql("outlet.elem")} = lower(${employeeParamSql}::text)
        OR ${outletInheritedFromClientManagerClause(employeeParamSql, clientAlias, "outlet.elem")}
        OR ${outletInheritedFromClientHardwareClause(employeeParamSql, clientAlias, "outlet.elem")}
      )
  )`;
}

export function employeesAccessibleOutletExistsClause(
  arrayParamSql: string,
  storeAlias: string,
  clientAlias: string,
): string {
  const employeeGuidsSql = `SELECT lower(g::text) FROM unnest(${arrayParamSql}::uuid[]) AS g`;
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias);
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(${outletsJson}) outlet(elem)
    WHERE ${outletStoreGuidSql("outlet.elem")} = lower(${storeAlias}.guid_store::text)
      AND (
        ${outletManagerGuidSql("outlet.elem")} = ANY(${employeeGuidsSql})
        OR ${outletHardwareGuidSql("outlet.elem")} = ANY(${employeeGuidsSql})
        OR ${outletRegionalGuidSql("outlet.elem")} = ANY(${employeeGuidsSql})
        OR (
          lower(${clientAlias}.guid_manager::text) = ANY(${employeeGuidsSql})
          AND (
            ${outletManagerGuidSql("outlet.elem")} IS NULL
            OR COALESCE(outlet.elem->'managers'->'manager'->>'state', '') IN ('unassigned', 'invalid', 'not_provided')
          )
        )
        OR (
          ${clientHardwareGuidSql(clientAlias)} = ANY(${employeeGuidsSql})
          AND (
            ${outletHardwareGuidSql("outlet.elem")} IS NULL
            OR COALESCE(outlet.elem->'managers'->'hardwareManager'->>'state', '') IN ('unassigned', 'invalid', 'not_provided')
          )
        )
      )
  )`;
}

export function employeesPortfolioClause(arrayParamSql: string): string {
  return `(
    (guid_manager = ANY(${arrayParamSql}::uuid[]) AND ${MANAGER_ROSTER_SCOPE_ALLOWED_SQL})
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
      WHERE ${outletManagerGuidSql("outlet.elem")} = ANY(
        SELECT lower(g::text) FROM unnest(${arrayParamSql}::uuid[]) AS g
      )
      OR ${outletHardwareGuidSql("outlet.elem")} = ANY(
        SELECT lower(g::text) FROM unnest(${arrayParamSql}::uuid[]) AS g
      )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
      WHERE lower(coalesce(outlet.elem->'managers'->'regionalManager'->>'guid', '')) = ANY(
        SELECT lower(g::text) FROM unnest(${arrayParamSql}::uuid[]) AS g
      )
    )
  )`;
}

export function ropTeamPortfolioClause(ropUserParamSql: string, ropEmployeeParamSql: string): string {
  return `(
    onec_clients.guid_manager IN (
      SELECT uoel.employee_id
      FROM rop_team_members rtm
      JOIN user_onec_employee_links uoel
        ON uoel.user_id = rtm.member_user_id AND uoel.revoked_at IS NULL
      WHERE rtm.rop_user_id = ${ropUserParamSql}::uuid AND rtm.revoked_at IS NULL
      UNION
      SELECT ${ropEmployeeParamSql}::uuid
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
      WHERE lower(coalesce(outlet.elem->'managers'->'regionalManager'->>'guid', '')) IN (
        SELECT lower(g::text)
        FROM (
          SELECT uoel.employee_id AS g
          FROM rop_team_members rtm
          JOIN user_onec_employee_links uoel
            ON uoel.user_id = rtm.member_user_id AND uoel.revoked_at IS NULL
          WHERE rtm.rop_user_id = ${ropUserParamSql}::uuid AND rtm.revoked_at IS NULL
          UNION
          SELECT ${ropEmployeeParamSql}::uuid AS g
        ) team_employees
      )
    )
  )`;
}
