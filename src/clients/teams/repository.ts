import { combineScopeAndFilter } from "../../access/combine-filters";
import { appendUserDenials, buildClientScopeSql } from "../../access/scope-sql";
import type { AccessContext } from "../../access/types";
import { query } from "../../db/pool";
import {
  ACTIVE_BASELINE_CLIENT_SQL,
  ACTIVE_BASELINE_OC_SQL,
  appendActiveBaselineFilter,
} from "../../onec-clients/baseline-active-scope";
import { MANAGER_ROSTER_SCOPE_ALLOWED_SQL } from "../../onec-clients/manager-status";
import { shortUuidLabel } from "../uuid-param";

const RETAIL_OUTLETS_JSON = `
  CASE
    WHEN jsonb_typeof(onec_clients.extended_snapshot->'currentRetailOutlets') = 'array'
      THEN onec_clients.extended_snapshot->'currentRetailOutlets'
    ELSE '[]'::jsonb
  END
`;

function employeePortfolioClause(employeeParamSql: string): string {
  return `(
    (guid_manager = ${employeeParamSql} AND ${MANAGER_ROSTER_SCOPE_ALLOWED_SQL})
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
      WHERE lower(coalesce(outlet.elem->'managers'->'regionalManager'->>'guid', '')) = lower(${employeeParamSql}::text)
    )
  )`;
}

function employeesPortfolioClause(arrayParamSql: string): string {
  return `(
    (guid_manager = ANY(${arrayParamSql}::uuid[]) AND ${MANAGER_ROSTER_SCOPE_ALLOWED_SQL})
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(${RETAIL_OUTLETS_JSON}) outlet(elem)
      WHERE lower(coalesce(outlet.elem->'managers'->'regionalManager'->>'guid', '')) = ANY(
        SELECT lower(g::text) FROM unnest(${arrayParamSql}::uuid[]) AS g
      )
    )
  )`;
}

export type TeamRopSummary = {
  ropUserId: string;
  ropName: string;
  ropEmployeeGuid: string | null;
  ropEmployeeName: string | null;
  ropEmployeeShortId: string | null;
  managerCount: number;
  uniqueClientCount: number;
};

export type TeamManagerSummary = {
  kind: "team_member" | "rop_own";
  userId: string | null;
  employeeGuid: string;
  name: string;
  shortId: string;
  clientCount: number;
};

function assertCanViewRopTeam(context: AccessContext, ropUserId: string): void {
  if (context.role === "admin" || context.fullClientBase) {
    return;
  }
  if (context.role === "rop" && context.userId === ropUserId) {
    return;
  }
  throw new TeamAccessError("Нет доступа к команде.", "FORBIDDEN");
}

export class TeamAccessError extends Error {
  code: "FORBIDDEN" | "NOT_FOUND";

  constructor(message: string, code: "FORBIDDEN" | "NOT_FOUND") {
    super(message);
    this.code = code;
  }
}

async function loadActiveRopRows(): Promise<
  Array<{
    rop_user_id: string;
    rop_name: string;
    employee_id: string | null;
    employee_name: string | null;
  }>
> {
  const result = await query<{
    rop_user_id: string;
    rop_name: string;
    employee_id: string | null;
    employee_name: string | null;
  }>(
    `
      SELECT DISTINCT ON (u.id)
        u.id::text AS rop_user_id,
        u.full_name AS rop_name,
        uoel.employee_id::text AS employee_id,
        oc.name_manager AS employee_name
      FROM users u
      LEFT JOIN user_onec_employee_links uoel
        ON uoel.user_id = u.id AND uoel.revoked_at IS NULL
      LEFT JOIN onec_clients oc
        ON oc.guid_manager = uoel.employee_id
       AND ${ACTIVE_BASELINE_OC_SQL.trim()}
      WHERE u.role = 'rop'
        AND u.status = 'active'
      ORDER BY u.id ASC, oc.last_imported_at DESC NULLS LAST
    `,
  );
  return result.rows;
}

function teamPortfolioCountScope(context: AccessContext) {
  if (context.role === "rop") {
    return appendActiveBaselineFilter(appendUserDenials({ whereSql: "", params: [] }, context.userId));
  }
  return buildClientScopeSql(context);
}

async function countDistinctClientsForEmployeeGuids(
  context: AccessContext,
  employeeGuids: string[],
): Promise<number> {
  if (employeeGuids.length === 0) {
    return 0;
  }
  const scope = teamPortfolioCountScope(context);
  const filter = combineScopeAndFilter(scope, {
    whereSql: `WHERE ${employeesPortfolioClause("$1")}`,
    params: [employeeGuids],
  });
  if (filter.whereSql === "WHERE FALSE") {
    return 0;
  }
  const result = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT guid_client)::text AS count FROM onec_clients ${filter.whereSql}`,
    filter.params,
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function countClientsForEmployee(context: AccessContext, employeeGuid: string): Promise<number> {
  const scope = teamPortfolioCountScope(context);
  const filter = combineScopeAndFilter(scope, {
    whereSql: `WHERE ${employeePortfolioClause("$1::uuid")}`,
    params: [employeeGuid],
  });
  if (filter.whereSql === "WHERE FALSE") {
    return 0;
  }
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_clients ${filter.whereSql}`,
    filter.params,
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function loadTeamMemberEmployeeGuids(ropUserId: string): Promise<
  Array<{
    member_user_id: string;
    employee_id: string;
    member_name: string;
  }>
> {
  const result = await query<{
    member_user_id: string;
    employee_id: string;
    member_name: string;
  }>(
    `
      SELECT
        rtm.member_user_id::text,
        uoel.employee_id::text,
        COALESCE(
          (
            SELECT oc.name_manager
            FROM onec_clients oc
            WHERE oc.guid_manager = uoel.employee_id
              AND ${ACTIVE_BASELINE_OC_SQL.trim()}
            ORDER BY oc.last_imported_at DESC
            LIMIT 1
          ),
          u.full_name
        ) AS member_name
      FROM rop_team_members rtm
      JOIN user_onec_employee_links uoel
        ON uoel.user_id = rtm.member_user_id AND uoel.revoked_at IS NULL
      JOIN users u ON u.id = rtm.member_user_id
      WHERE rtm.rop_user_id = $1::uuid
        AND rtm.revoked_at IS NULL
        AND u.status = 'active'
      ORDER BY member_name ASC, uoel.employee_id ASC
    `,
    [ropUserId],
  );
  return result.rows;
}

export async function listTeamRops(context: AccessContext): Promise<TeamRopSummary[]> {
  const allRops = await loadActiveRopRows();
  const visibleRops =
    context.role === "admin" || context.fullClientBase
      ? allRops
      : context.role === "rop"
        ? allRops.filter((row) => row.rop_user_id === context.userId)
        : [];

  const summaries: TeamRopSummary[] = [];
  for (const rop of visibleRops) {
    const members = await loadTeamMemberEmployeeGuids(rop.rop_user_id);
    const employeeGuids = members.map((m) => m.employee_id);
    if (rop.employee_id) {
      employeeGuids.push(rop.employee_id);
    }
    const uniqueGuids = [...new Set(employeeGuids)];
    summaries.push({
      ropUserId: rop.rop_user_id,
      ropName: rop.rop_name,
      ropEmployeeGuid: rop.employee_id,
      ropEmployeeName: rop.employee_name,
      ropEmployeeShortId: rop.employee_id ? shortUuidLabel(rop.employee_id) : null,
      managerCount: members.length,
      uniqueClientCount: await countDistinctClientsForEmployeeGuids(context, uniqueGuids),
    });
  }
  return summaries;
}

export async function listTeamManagers(
  context: AccessContext,
  ropUserId: string,
): Promise<TeamManagerSummary[]> {
  assertCanViewRopTeam(context, ropUserId);

  const ropExists = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM users
      WHERE id = $1::uuid AND role = 'rop' AND status = 'active'
    `,
    [ropUserId],
  );
  if (Number(ropExists.rows[0]?.count ?? "0") === 0) {
    throw new TeamAccessError("Команда не найдена.", "NOT_FOUND");
  }

  const members = await loadTeamMemberEmployeeGuids(ropUserId);
  const summaries: TeamManagerSummary[] = [];
  for (const member of members) {
    summaries.push({
      kind: "team_member",
      userId: member.member_user_id,
      employeeGuid: member.employee_id,
      name: member.member_name,
      shortId: shortUuidLabel(member.employee_id),
      clientCount: await countClientsForEmployee(context, member.employee_id),
    });
  }

  const ropLink = await query<{ employee_id: string; name_manager: string | null }>(
    `
      SELECT
        uoel.employee_id::text,
        (
          SELECT oc.name_manager
          FROM onec_clients oc
          WHERE oc.guid_manager = uoel.employee_id
            AND ${ACTIVE_BASELINE_OC_SQL.trim()}
          ORDER BY oc.last_imported_at DESC
          LIMIT 1
        ) AS name_manager
      FROM user_onec_employee_links uoel
      WHERE uoel.user_id = $1::uuid AND uoel.revoked_at IS NULL
    `,
    [ropUserId],
  );
  const ropEmployee = ropLink.rows[0];
  if (ropEmployee) {
    summaries.push({
      kind: "rop_own",
      userId: ropUserId,
      employeeGuid: ropEmployee.employee_id,
      name: ropEmployee.name_manager ?? "Собственные клиенты РОП",
      shortId: shortUuidLabel(ropEmployee.employee_id),
      clientCount: await countClientsForEmployee(context, ropEmployee.employee_id),
    });
  }

  return summaries;
}

export async function assertManagerInTeamScope(
  context: AccessContext,
  ropUserId: string,
  managerEmployeeGuid: string,
): Promise<void> {
  const managers = await listTeamManagers(context, ropUserId);
  const allowed = managers.some((m) => m.employeeGuid.toLowerCase() === managerEmployeeGuid.toLowerCase());
  if (!allowed) {
    throw new TeamAccessError("Менеджер не входит в команду.", "FORBIDDEN");
  }
}

export function buildTeamManagerFilter(
  context: AccessContext,
  managerEmployeeGuid: string,
): ReturnType<typeof combineScopeAndFilter> {
  const scope = buildClientScopeSql(context);
  return combineScopeAndFilter(scope, {
    whereSql: "WHERE guid_manager = $1::uuid",
    params: [managerEmployeeGuid.toLowerCase()],
  });
}

export async function loadTeamEmployeeGuids(ropUserId: string): Promise<string[]> {
  const members = await loadTeamMemberEmployeeGuids(ropUserId);
  const guids = members.map((member) => member.employee_id);
  const ropLink = await query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE user_id = $1::uuid AND revoked_at IS NULL
    `,
    [ropUserId],
  );
  const ropEmployee = ropLink.rows[0];
  if (ropEmployee) {
    guids.push(ropEmployee.employee_id);
  }
  return [...new Set(guids.map((guid) => guid.toLowerCase()))];
}

export async function buildTeamRopFilter(ropUserId: string): Promise<{ whereSql: string; params: unknown[] }> {
  const employeeGuids = await loadTeamEmployeeGuids(ropUserId);
  if (employeeGuids.length === 0) {
    return { whereSql: "WHERE FALSE", params: [] };
  }
  return {
    whereSql: `WHERE ${employeesPortfolioClause("$1")}`,
    params: [employeeGuids],
  };
}
