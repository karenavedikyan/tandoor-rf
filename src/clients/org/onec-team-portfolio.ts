import type { AccessContext } from "../../access/types";
import { mergeSqlFilters } from "../../access/combine-filters";
import { query } from "../../db/pool";
import { isValidNonZeroUuid } from "../../onec-clients/uuid";
import type { SqlFilter } from "../query";
import { buildOutletScope } from "../outlets/scope-sql";
import {
  employeesAccessibleOutletExistsClause,
  employeesDirectClientListClause,
} from "../team-portfolio-sql";
import { ONEC_TEAM_UNDEFINED_KEY } from "./onec-teams-repository";

export class OnecTeamPortfolioAccessError extends Error {
  code: "FORBIDDEN" | "NOT_FOUND";

  constructor(message: string, code: "FORBIDDEN" | "NOT_FOUND") {
    super(message);
    this.code = code;
  }
}

async function loadTeamLeaderGuid(teamGuid: string): Promise<string | null> {
  const row = await query<{ leader_guid: string | null }>(
    `
      SELECT lower(guid_team_leader::text) AS leader_guid
      FROM onec_wholesale_team_groups
      WHERE guid_team = $1::uuid
    `,
    [teamGuid],
  );
  return row.rows[0]?.leader_guid ?? null;
}

export async function loadOnecTeamMemberGuids(teamToken: string): Promise<string[]> {
  if (teamToken === ONEC_TEAM_UNDEFINED_KEY) {
    const rows = await query<{ employee_guid: string }>(
      `
        SELECT lower(r.guid_manager::text) AS employee_guid
        FROM onec_wholesale_employee_roster r
        WHERE NOT EXISTS (
          SELECT 1
          FROM onec_wholesale_employee_team_memberships m
          WHERE m.guid_manager = r.guid_manager
        )
        AND r.guid_team IS NULL
        ORDER BY r.name_manager ASC, r.guid_manager ASC
      `,
    );
    return rows.rows.map((row) => row.employee_guid);
  }

  if (!isValidNonZeroUuid(teamToken)) {
    return [];
  }

  const membershipRows = await query<{ employee_guid: string }>(
    `
      SELECT lower(m.guid_manager::text) AS employee_guid
      FROM onec_wholesale_employee_team_memberships m
      WHERE lower(m.guid_team::text) = $1
      UNION
      SELECT lower(r.guid_manager::text) AS employee_guid
      FROM onec_wholesale_employee_roster r
      WHERE lower(r.guid_team::text) = $1
        AND NOT EXISTS (
          SELECT 1
          FROM onec_wholesale_employee_team_memberships m
          WHERE m.guid_manager = r.guid_manager
        )
    `,
    [teamToken.toLowerCase()],
  );
  return [...new Set(membershipRows.rows.map((row) => row.employee_guid))];
}

export async function assertOnecTeamPortfolioAccess(
  context: AccessContext,
  teamToken: string,
): Promise<string[]> {
  if (context.status !== "active") {
    throw new OnecTeamPortfolioAccessError("Аккаунт неактивен.", "FORBIDDEN");
  }
  if (context.employeeLinkConflict) {
    throw new OnecTeamPortfolioAccessError("Конфликт привязки сотрудника 1С.", "FORBIDDEN");
  }
  const memberGuids = await loadOnecTeamMemberGuids(teamToken);
  if (memberGuids.length === 0 && teamToken !== ONEC_TEAM_UNDEFINED_KEY) {
    throw new OnecTeamPortfolioAccessError("Группа 1С не найдена.", "NOT_FOUND");
  }

  if (context.role === "admin" || context.fullClientBase) {
    return memberGuids;
  }

  if (context.role === "rop" && context.employeeId) {
    if (teamToken === ONEC_TEAM_UNDEFINED_KEY) {
      throw new OnecTeamPortfolioAccessError("Группа 1С недоступна для вашей роли.", "FORBIDDEN");
    }
    const leaderGuid = await loadTeamLeaderGuid(teamToken);
    if (leaderGuid?.toLowerCase() !== context.employeeId.toLowerCase()) {
      throw new OnecTeamPortfolioAccessError("Нет доступа к портфелю группы 1С.", "FORBIDDEN");
    }
    return memberGuids;
  }

  throw new OnecTeamPortfolioAccessError("Портфель группы 1С недоступен для вашей роли.", "FORBIDDEN");
}

export function buildOnecTeamClientsFilter(employeeGuids: string[]): SqlFilter {
  if (employeeGuids.length === 0) {
    return { whereSql: "WHERE FALSE", params: [] };
  }
  return {
    whereSql: `WHERE ${employeesDirectClientListClause("$1")}`,
    params: [employeeGuids],
  };
}

export function onecTeamManagerAccessFilter(
  memberGuids: string[],
  managerId: string | undefined,
): SqlFilter | null {
  if (!managerId) {
    return null;
  }
  const allowed = memberGuids.some((guid) => guid.toLowerCase() === managerId.toLowerCase());
  if (allowed) {
    return null;
  }
  return { whereSql: "WHERE FALSE", params: [] };
}

export function buildOnecTeamOutletsFilter(employeeGuids: string[]): SqlFilter {
  if (employeeGuids.length === 0) {
    return { whereSql: "WHERE FALSE", params: [] };
  }
  return {
    whereSql: `WHERE ${employeesAccessibleOutletExistsClause("$1", "ro", "oc")}`,
    params: [employeeGuids],
  };
}

export function mergeOutletScopeWithOnecPortfolioFilter(
  context: AccessContext,
  employeeGuids: string[],
): SqlFilter {
  if (employeeGuids.length === 0) {
    return { whereSql: "WHERE FALSE", params: [] };
  }
  const outletScope = buildOutletScope(context, {
    ropDirectClientList: context.role === "rop",
    managerDirectClientList: context.role === "manager",
  });
  const portfolio = buildOnecTeamOutletsFilter(employeeGuids);
  const portfolioClause = portfolio.whereSql.replace(/^WHERE\s+/i, "").trim();
  return mergeSqlFilters(outletScope, [portfolioClause], portfolio.params);
}

export async function countUniqueOutletsForEmployeeGuids(
  context: AccessContext,
  employeeGuids: string[],
): Promise<number> {
  if (employeeGuids.length === 0) {
    return 0;
  }
  const combined = mergeOutletScopeWithOnecPortfolioFilter(context, employeeGuids);
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT ro.guid_store)::text AS count
      FROM onec_retail_outlets ro
      JOIN onec_clients oc ON oc.guid_client = ro.guid_client
      ${combined.whereSql}
    `,
    combined.params,
  );
  return Number(result.rows[0]?.count ?? "0");
}
