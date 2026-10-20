import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { shortUuidLabel } from "../uuid-param";
import { ORG_DIRECTOR_EMPLOYEE_GUID, ROSTER_ROP_POST_LABEL } from "../org/constants";
import {
  OrgStructureAccessError,
  type OrgResponsibleSummary,
  type OrgDirectorSummary,
  type OrgStructureOverview,
  type OrgRopSummary,
} from "../org/structure-repository";
import { selfRopEmployeeGuidFromContext } from "../self-rop-identity";
import { v3EntityAssignmentScope } from "./access-scope";
import { readableGroupKey } from "./list-legal-grouped";
import { v3JsonManagerField } from "./json-paths";
import {
  buildV3TeamResponsibleSummaries,
  countDistinctV3TeamPortfolio,
  loadV3TeamMemberGuids,
  resolveV3TeamGroupLeaderBinding,
} from "./team-assignment-counts";

function assertAccess(context: AccessContext): void {
  if (context.status !== "active") {
    throw new OrgStructureAccessError("Аккаунт неактивен.", "FORBIDDEN");
  }
  if (context.role === "admin" || context.fullClientBase) {
    return;
  }
  if (context.role === "rop" && context.employeeId && context.hasEmployeeLink && !context.employeeLinkConflict) {
    return;
  }
  throw new OrgStructureAccessError("Структура по назначениям недоступна для вашей роли.", "FORBIDDEN");
}

function v3HeadOfSalesClause(alias: string, ropParam: string): string {
  return `NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidHeadOfSales")}, '')), '')::uuid = ${ropParam}::uuid`;
}

async function loadV3DirectorSummary(linked: Set<string>): Promise<OrgDirectorSummary | null> {
  const result = await query<{ guid_manager: string; name_manager: string; post: string | null }>(
    `
      SELECT guid_manager::text, name_manager, post
      FROM onec_wholesale_employee_roster
      WHERE lower(guid_manager::text) = $1
      LIMIT 1
    `,
    [ORG_DIRECTOR_EMPLOYEE_GUID],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    employeeGuid: ORG_DIRECTOR_EMPLOYEE_GUID,
    name: row.name_manager,
    shortId: shortUuidLabel(ORG_DIRECTOR_EMPLOYEE_GUID),
    rosterPost: row.post,
    hasLinkedAccount: linked.has(ORG_DIRECTOR_EMPLOYEE_GUID),
    note: "Организационная роль директора задаётся по GUID 1С и не дублируется в списке РОП.",
  };
}

function teamCountsFromResponsibles(items: OrgResponsibleSummary[]): {
  managerCount: number;
  regionalCount: number;
  teamMemberCount: number;
} {
  const managers = new Set<string>();
  const regionals = new Set<string>();
  const allMembers = new Set<string>();
  for (const item of items) {
    const guid = item.employeeGuid.toLowerCase();
    allMembers.add(guid);
    if (item.kind === "manager") {
      managers.add(guid);
    } else if (item.kind === "regional") {
      regionals.add(guid);
    }
  }
  return {
    managerCount: managers.size,
    regionalCount: regionals.size,
    teamMemberCount: allMembers.size,
  };
}

async function wholesaleTeamGroupsLoaded(): Promise<boolean> {
  const count = Number(
    (await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_wholesale_team_groups`)).rows[0]
      ?.count ?? 0,
  );
  return count > 0;
}

async function countTeamMembersForGroup(teamGuid: string, leaderGuid: string): Promise<number> {
  const result = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_wholesale_employee_team_memberships m
      WHERE m.guid_team = $1::uuid
        AND lower(m.guid_manager::text) <> lower($2::text)
    `,
    [teamGuid, leaderGuid],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function buildV3OrgOverviewFromTeamGroups(
  context: AccessContext,
  linked: Set<string>,
  director: OrgStructureOverview["director"],
): Promise<OrgRopSummary[]> {
  const groups = await query<{
    guid_team: string;
    name_team: string | null;
    guid_team_leader: string | null;
    name_team_leader: string | null;
  }>(
    `
      SELECT
        guid_team::text,
        name_team,
        guid_team_leader::text,
        name_team_leader
      FROM onec_wholesale_team_groups
      ORDER BY COALESCE(name_team, ''), guid_team ASC
    `,
  );
  const rops: OrgRopSummary[] = [];
  for (const group of groups.rows) {
    const leaderGuid = group.guid_team_leader;
    if (!leaderGuid || leaderGuid.toLowerCase() === ORG_DIRECTOR_EMPLOYEE_GUID) {
      continue;
    }
    const teamMemberCount = await countTeamMembersForGroup(group.guid_team, leaderGuid);
    const memberGuids = await loadV3TeamMemberGuids(leaderGuid, group.guid_team);
    const counts = await countDistinctV3TeamPortfolio(context, memberGuids);
    const hasPortfolio = counts.legal + counts.retail > 0;
    let managerCount = 0;
    let regionalCount = 0;
    if (teamMemberCount > 0) {
      const responsibles = await listV3RosterTeamResponsibles(context, leaderGuid, group.guid_team);
      const teamCounts = teamCountsFromResponsibles(responsibles);
      managerCount = teamCounts.managerCount;
      regionalCount = teamCounts.regionalCount;
    }
    rops.push({
      employeeGuid: leaderGuid,
      name: group.name_team || group.name_team_leader || shortUuidLabel(leaderGuid),
      shortId: shortUuidLabel(leaderGuid),
      rosterPost: null,
      hasLinkedAccount: linked.has(leaderGuid.toLowerCase()),
      hasAssignedPortfolio: hasPortfolio,
      portfolioNote: hasPortfolio ? null : "Нет объектов v3 в ветке команды",
      managerCount,
      regionalCount,
      teamMemberCount,
      uniqueClientCount: counts.legal,
      uniqueOutletCount: counts.retail,
      parentClientCount: 0,
      sources: ["roster"],
      teamGuid: group.guid_team,
      teamName: group.name_team,
    });
  }
  return rops;
}

async function listV3RosterTeamResponsibles(
  context: AccessContext,
  leaderGuid: string,
  teamGuid?: string | null,
): Promise<OrgResponsibleSummary[]> {
  if (teamGuid) {
    const binding = await resolveV3TeamGroupLeaderBinding(teamGuid, leaderGuid);
    if (binding === "missing") {
      return [];
    }
    if (binding === "leader_mismatch") {
      throw new OrgStructureAccessError(
        "Запрошенная группа не относится к указанному руководителю.",
        "FORBIDDEN",
      );
    }
  }
  const linked = new Set(
    (
      await query<{ employee_id: string }>(
        `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
      )
    ).rows.map((r) => r.employee_id.toLowerCase()),
  );
  const rows = await query<{ employee_guid: string; name: string | null }>(
    teamGuid
      ? `
        SELECT lower(m.guid_manager::text) AS employee_guid, r.name_manager AS name
        FROM onec_wholesale_employee_team_memberships m
        JOIN onec_wholesale_employee_roster r ON r.guid_manager = m.guid_manager
        WHERE m.guid_team = $1::uuid
          AND lower(m.guid_manager::text) <> lower($2::text)
        ORDER BY r.name_manager ASC NULLS LAST, m.guid_manager ASC
      `
      : `
        SELECT lower(m.guid_manager::text) AS employee_guid, r.name_manager AS name
        FROM onec_wholesale_team_groups g
        JOIN onec_wholesale_employee_team_memberships m ON m.guid_team = g.guid_team
        JOIN onec_wholesale_employee_roster r ON r.guid_manager = m.guid_manager
        WHERE lower(g.guid_team_leader::text) = lower($1::text)
          AND lower(m.guid_manager::text) <> lower($1::text)
        GROUP BY lower(m.guid_manager::text), r.name_manager
        ORDER BY r.name_manager ASC NULLS LAST, lower(m.guid_manager::text) ASC
      `,
    teamGuid ? [teamGuid, leaderGuid] : [leaderGuid],
  );
  const memberGuids = rows.rows.map((row) => row.employee_guid.toLowerCase());
  return buildV3TeamResponsibleSummaries(context, linked, rows.rows, memberGuids);
}

async function countBranch(context: AccessContext, ropGuid: string): Promise<{ legal: number; retail: number }> {
  const leScope = v3EntityAssignmentScope(context, "le", "legal");
  const roScope = v3EntityAssignmentScope(context, "ro", "retail");
  const leParams = [...leScope.params];
  const groupKey = readableGroupKey(context, leParams);
  const ropIdxLe = leParams.length + 1;
  leParams.push(ropGuid);
  const ropIdxRo = roScope.params.length + 1;
  const [legal, retail] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(DISTINCT ${groupKey})::text AS count FROM onec_v3_legal_entities le
       WHERE (${leScope.clause}) AND ${v3HeadOfSalesClause("le", `$${ropIdxLe}`)}`,
      leParams,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM onec_v3_retail_outlets ro
       WHERE (${roScope.clause}) AND ${v3HeadOfSalesClause("ro", `$${ropIdxRo}`)}`,
      [...roScope.params, ropGuid],
    ),
  ]);
  return {
    legal: Number(legal.rows[0]?.count ?? 0),
    retail: Number(retail.rows[0]?.count ?? 0),
  };
}

export async function getV3OrgStructureOverview(context: AccessContext): Promise<OrgStructureOverview> {
  assertAccess(context);
  const rosterLoaded =
    Number(
      (
        await query<{ employee_count: number }>(
          `SELECT employee_count FROM onec_wholesale_roster_state WHERE id = 1`,
        )
      ).rows[0]?.employee_count ?? 0,
    ) > 0;
  const linked = new Set(
    (
      await query<{ employee_id: string }>(
        `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
      )
    ).rows.map((r) => r.employee_id.toLowerCase()),
  );
  const rosterRops = await query<{ guid_manager: string; name_manager: string; post: string | null }>(
    `SELECT guid_manager::text, name_manager, post
     FROM onec_wholesale_employee_roster
     WHERE post = $1 AND lower(guid_manager::text) <> $2`,
    [ROSTER_ROP_POST_LABEL, ORG_DIRECTOR_EMPLOYEE_GUID],
  );
  const director =
    context.role === "admin" || context.fullClientBase ? await loadV3DirectorSummary(linked) : null;
  if (rosterLoaded && (await wholesaleTeamGroupsLoaded())) {
    const rops = await buildV3OrgOverviewFromTeamGroups(context, linked, director);
    return {
      director,
      rops,
      undefinedTeam: [],
      rosterLoaded,
      limitationNote:
        "Структура команд построена по группам all_employees (team[]), без фильтра только по должности РОП.",
      selfRopEmployeeGuid: selfRopEmployeeGuidFromContext(context),
    };
  }
  const rops: OrgRopSummary[] = [];
  for (const row of rosterRops.rows) {
    if (row.guid_manager.toLowerCase() === ORG_DIRECTOR_EMPLOYEE_GUID) {
      continue;
    }
    const counts = await countBranch(context, row.guid_manager);
    const hasPortfolio = counts.legal + counts.retail > 0;
    let managerCount = 0;
    let regionalCount = 0;
    let teamMemberCount = 0;
    if (hasPortfolio && rosterLoaded) {
      const responsibles = await listV3RopResponsibles(context, row.guid_manager);
      const teamCounts = teamCountsFromResponsibles(responsibles);
      managerCount = teamCounts.managerCount;
      regionalCount = teamCounts.regionalCount;
      teamMemberCount = teamCounts.teamMemberCount;
    }
    rops.push({
      employeeGuid: row.guid_manager,
      name: row.name_manager,
      shortId: shortUuidLabel(row.guid_manager),
      rosterPost: row.post,
      hasLinkedAccount: linked.has(row.guid_manager.toLowerCase()),
      hasAssignedPortfolio: hasPortfolio,
      portfolioNote: hasPortfolio ? null : "Нет объектов v3 в ветке РОП",
      managerCount,
      regionalCount,
      teamMemberCount,
      uniqueClientCount: counts.legal,
      uniqueOutletCount: counts.retail,
      parentClientCount: 0,
      sources: ["roster"],
    });
  }
  return {
    director,
    rops,
    undefinedTeam: [],
    rosterLoaded,
    limitationNote:
      "Структура команд построена по объектам exchange v3 и справочнику ОПТ (без legacy onec_clients).",
    selfRopEmployeeGuid: selfRopEmployeeGuidFromContext(context),
  };
}

export async function listV3RopResponsibles(
  context: AccessContext,
  ropEmployeeGuid: string,
  options?: { teamGuid?: string | null },
): Promise<OrgResponsibleSummary[]> {
  assertAccess(context);
  if (context.role === "rop" && context.employeeId?.toLowerCase() !== ropEmployeeGuid.toLowerCase()) {
    throw new OrgStructureAccessError("Нет доступа к ветке РОП.", "FORBIDDEN");
  }
  if (await wholesaleTeamGroupsLoaded()) {
    return listV3RosterTeamResponsibles(context, ropEmployeeGuid, options?.teamGuid);
  }
  const leScope = v3EntityAssignmentScope(context, "le", "legal");
  const roScope = v3EntityAssignmentScope(context, "ro", "retail");
  const leParams = [...leScope.params];
  const legalGroupKey = readableGroupKey(context, leParams);
  const leLen = leParams.length;
  const roLen = roScope.params.length;
  const roScopeOffset = leLen + 2;
  let roScopeClause = roScope.clause;
  if (roLen > 0) {
    roScopeClause = roScopeClause.replace(/\$(\d+)/g, (_match, index: string) => `$${Number(index) + roScopeOffset}`);
  }
  const ropLe = leLen + 1;
  const ropExLe = leLen + 2;
  const ropRo = leLen + 2 + roLen + 1;
  const ropExRo = leLen + 2 + roLen + 2;
  const sqlParams = [...leParams, ropEmployeeGuid, ropEmployeeGuid, ...roScope.params, ropEmployeeGuid, ropEmployeeGuid];
  const linked = new Set(
    (
      await query<{ employee_id: string }>(
        `SELECT employee_id::text FROM user_onec_employee_links WHERE revoked_at IS NULL`,
      )
    ).rows.map((r) => r.employee_id.toLowerCase()),
  );

  const rows = await query<{
    kind: "manager" | "regional" | "hardware";
    employee_guid: string;
    name: string | null;
    client_count: string;
    outlet_count: string;
  }>(
    `
      WITH branch_legal AS (
        SELECT le.*, ${legalGroupKey} AS group_key FROM onec_v3_legal_entities le
        WHERE (${leScope.clause}) AND ${v3HeadOfSalesClause("le", `$${ropLe}`)}
      ),
      branch_retail AS (
        SELECT ro.* FROM onec_v3_retail_outlets ro
        WHERE (${roScopeClause}) AND ${v3HeadOfSalesClause("ro", `$${ropRo}`)}
      ),
      legal_mgr AS (
        SELECT 'manager'::text AS kind,
          lower(${v3JsonManagerField("branch_legal", "guidManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_legal", "nameManager")}) AS name,
          COUNT(DISTINCT group_key)::text AS client_count, '0'::text AS outlet_count
        FROM branch_legal
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidManager")}), '')::uuid IS DISTINCT FROM $${ropExLe}::uuid
        GROUP BY 2
      ),
      legal_reg AS (
        SELECT 'regional'::text AS kind,
          lower(${v3JsonManagerField("branch_legal", "guidRegionalManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_legal", "nameRegionalManager")}) AS name,
          COUNT(DISTINCT group_key)::text AS client_count, '0'::text AS outlet_count
        FROM branch_legal
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidRegionalManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidRegionalManager")}), '')::uuid IS DISTINCT FROM $${ropExLe}::uuid
        GROUP BY 2
      ),
      legal_hw AS (
        SELECT 'hardware'::text AS kind,
          lower(${v3JsonManagerField("branch_legal", "guidHardwareManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_legal", "nameHardwareManager")}) AS name,
          COUNT(DISTINCT group_key)::text AS client_count, '0'::text AS outlet_count
        FROM branch_legal
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidHardwareManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_legal", "guidHardwareManager")}), '')::uuid IS DISTINCT FROM $${ropExLe}::uuid
        GROUP BY 2
      ),
      retail_mgr AS (
        SELECT 'manager'::text AS kind,
          lower(${v3JsonManagerField("branch_retail", "guidManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_retail", "nameManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM branch_retail
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidManager")}), '')::uuid IS DISTINCT FROM $${ropExRo}::uuid
        GROUP BY 2
      ),
      retail_reg AS (
        SELECT 'regional'::text AS kind,
          lower(${v3JsonManagerField("branch_retail", "guidRegionalManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_retail", "nameRegionalManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM branch_retail
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidRegionalManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidRegionalManager")}), '')::uuid IS DISTINCT FROM $${ropExRo}::uuid
        GROUP BY 2
      ),
      retail_hw AS (
        SELECT 'hardware'::text AS kind,
          lower(${v3JsonManagerField("branch_retail", "guidHardwareManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("branch_retail", "nameHardwareManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM branch_retail
        WHERE NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidHardwareManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("branch_retail", "guidHardwareManager")}), '')::uuid IS DISTINCT FROM $${ropExRo}::uuid
        GROUP BY 2
      ),
      merged AS (
        SELECT * FROM legal_mgr UNION ALL SELECT * FROM legal_reg UNION ALL SELECT * FROM legal_hw
        UNION ALL SELECT * FROM retail_mgr UNION ALL SELECT * FROM retail_reg UNION ALL SELECT * FROM retail_hw
      )
      SELECT kind, employee_guid, MAX(name) AS name,
        SUM(client_count::int)::text AS client_count,
        SUM(outlet_count::int)::text AS outlet_count
      FROM merged
      GROUP BY kind, employee_guid
      ORDER BY kind, name
    `,
    sqlParams,
  );

  return rows.rows.map((row) => ({
    kind: row.kind,
    employeeGuid: row.employee_guid,
    name: row.name || row.employee_guid.slice(0, 8),
    shortId: shortUuidLabel(row.employee_guid),
    hasLinkedAccount: linked.has(row.employee_guid.toLowerCase()),
    rosterInOpt: null,
    clientCount: Number(row.client_count),
    outletCount: Number(row.outlet_count),
  }));
}
