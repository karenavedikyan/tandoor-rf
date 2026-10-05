import {
  clientAssignedToRopClause,
  outletAssignedToRopClause,
  outletAssignedToRopExistsClause,
} from "../clients/org/assignment-sql";
import { RETAIL_OUTLETS_JSON, ropTeamPortfolioClause } from "../clients/team-portfolio-sql";
import { query } from "../db/pool";

function withClientAlias(clause: string, clientAlias: string): string {
  return clause.replaceAll("onec_clients.", `${clientAlias}.`);
}

/** Legacy manual team portfolio (rop_team_members). */
export function ropLegacyTeamClientClause(
  ropUserParamSql: string,
  ropEmployeeParamSql: string,
  clientAlias = "onec_clients",
): string {
  return withClientAlias(
    ropTeamPortfolioClause(ropUserParamSql, ropEmployeeParamSql),
    clientAlias,
  );
}

/** ROP employees linked to the legacy team (including the ROP themselves). */
export function ropLegacyTeamEmployeesSubquery(
  ropUserParamSql: string,
  ropEmployeeParamSql: string,
): string {
  return `
    SELECT uoel.employee_id AS employee_guid
    FROM rop_team_members rtm
    JOIN user_onec_employee_links uoel
      ON uoel.user_id = rtm.member_user_id
     AND uoel.revoked_at IS NULL
    WHERE rtm.rop_user_id = ${ropUserParamSql}::uuid
      AND rtm.revoked_at IS NULL
    UNION
    SELECT ${ropEmployeeParamSql}::uuid AS employee_guid
  `;
}

/**
 * Full read scope for cards, org structure, completeness and outlet-parent access:
 * legacy team, direct 1C client assignment, or at least one outlet assigned in 1C.
 */
export function ropFullClientReadClause(
  ropUserParamSql: string,
  ropEmployeeParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `(
    ${ropLegacyTeamClientClause(ropUserParamSql, ropEmployeeParamSql, clientAlias)}
    OR ${clientAssignedToRopClause(ropEmployeeParamSql, clientAlias)}
    OR ${outletAssignedToRopExistsClause(ropEmployeeParamSql, clientAlias)}
  )`;
}

/**
 * Client list scope: legacy team or direct 1C client assignment.
 * Outlet-only parents stay out of the client list but remain reachable via outlets/cards.
 */
export function ropDirectClientListClause(
  ropUserParamSql: string,
  ropEmployeeParamSql: string,
  clientAlias = "onec_clients",
): string {
  return `(
    ${ropLegacyTeamClientClause(ropUserParamSql, ropEmployeeParamSql, clientAlias)}
    OR ${clientAssignedToRopClause(ropEmployeeParamSql, clientAlias)}
  )`;
}

/**
 * Per-outlet visibility for ROP sessions:
 * all outlets of a directly assigned client, assigned outlets otherwise,
 * or all outlets for legacy team clients.
 */
export function ropOutletRowAccessibleClause(
  ropUserParamSql: string,
  ropEmployeeParamSql: string,
  storeAlias: string,
  clientAlias: string,
): string {
  const outletsJson = RETAIL_OUTLETS_JSON.replaceAll("onec_clients", clientAlias);
  const teamEmployees = ropLegacyTeamEmployeesSubquery(ropUserParamSql, ropEmployeeParamSql);
  return `(
    ${clientAssignedToRopClause(ropEmployeeParamSql, clientAlias)}
    OR lower(${clientAlias}.guid_manager::text) IN (
      SELECT lower(employee_guid::text) FROM (${teamEmployees}) team
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${outletsJson}) outlet(elem)
      WHERE lower(coalesce(outlet.elem->>'guidStore', '')) = lower(${storeAlias}.guid_store::text)
        AND (
          ${outletAssignedToRopClause(ropEmployeeParamSql, "outlet.elem")}
          OR lower(coalesce(outlet.elem->'managers'->'regionalManager'->>'guid', '')) IN (
            SELECT lower(employee_guid::text) FROM (${teamEmployees}) team_reg
          )
        )
    )
  )`;
}

/** Active legacy team employee GUIDs for the current ROP (includes the ROP employee). */
export async function loadRopTeamEmployeeGuids(
  ropUserId: string,
  ropEmployeeId: string,
): Promise<Set<string>> {
  const result = await query<{ employee_guid: string }>(
    `
      SELECT uoel.employee_id::text AS employee_guid
      FROM rop_team_members rtm
      JOIN user_onec_employee_links uoel
        ON uoel.user_id = rtm.member_user_id
       AND uoel.revoked_at IS NULL
      WHERE rtm.rop_user_id = $1::uuid
        AND rtm.revoked_at IS NULL
      UNION
      SELECT $2::uuid::text AS employee_guid
    `,
    [ropUserId, ropEmployeeId],
  );
  return new Set(result.rows.map((row) => row.employee_guid.toLowerCase()));
}
