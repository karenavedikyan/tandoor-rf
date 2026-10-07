import { managerClientPortfolioClause, outletManagerGuidSql } from "./org/assignment-sql";
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
    ${managerClientPortfolioClause(employeeParamSql)}
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
      WHERE lower(coalesce(outlet.elem->'managers'->'regionalManager'->>'guid', '')) = lower(${employeeParamSql}::text)
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
