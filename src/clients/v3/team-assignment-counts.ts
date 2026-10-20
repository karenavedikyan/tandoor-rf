import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { shortUuidLabel } from "../uuid-param";
import { OrgStructureAccessError, type OrgResponsibleSummary } from "../org/structure-repository";
import { v3EntityAssignmentScope } from "./access-scope";
import { readableGroupKey } from "./list-legal-grouped";
import { v3JsonManagerField } from "./json-paths";

export async function resolveV3TeamGroupLeaderBinding(
  teamGuid: string,
  leaderGuid: string,
): Promise<"ok" | "missing" | "leader_mismatch"> {
  const result = await query<{ guid_team_leader: string | null }>(
    `
      SELECT guid_team_leader::text
      FROM onec_wholesale_team_groups
      WHERE guid_team = $1::uuid
      LIMIT 1
    `,
    [teamGuid],
  );
  const row = result.rows[0];
  if (!row) {
    return "missing";
  }
  if (!row.guid_team_leader || row.guid_team_leader.toLowerCase() !== leaderGuid.toLowerCase()) {
    return "leader_mismatch";
  }
  return "ok";
}

export async function loadV3TeamMemberGuids(
  leaderGuid: string,
  teamGuid?: string | null,
): Promise<string[]> {
  const rows = await query<{ employee_guid: string }>(
    teamGuid
      ? `
        SELECT lower(m.guid_manager::text) AS employee_guid
        FROM onec_wholesale_employee_team_memberships m
        WHERE m.guid_team = $1::uuid
          AND lower(m.guid_manager::text) <> lower($2::text)
        ORDER BY m.guid_manager ASC
      `
      : `
        SELECT lower(m.guid_manager::text) AS employee_guid
        FROM onec_wholesale_team_groups g
        JOIN onec_wholesale_employee_team_memberships m ON m.guid_team = g.guid_team
        WHERE lower(g.guid_team_leader::text) = lower($1::text)
          AND lower(m.guid_manager::text) <> lower($1::text)
        GROUP BY lower(m.guid_manager::text)
        ORDER BY lower(m.guid_manager::text) ASC
      `,
    teamGuid ? [teamGuid, leaderGuid] : [leaderGuid],
  );
  return rows.rows.map((row) => row.employee_guid.toLowerCase());
}

export async function assertV3TeamTerritoryAccess(
  context: AccessContext,
  leaderGuid: string,
  teamGuid: string,
): Promise<string[]> {
  const binding = await resolveV3TeamGroupLeaderBinding(teamGuid, leaderGuid);
  if (binding === "missing") {
    throw new OrgStructureAccessError("Группа команды не найдена.", "FORBIDDEN");
  }
  if (binding === "leader_mismatch") {
    throw new OrgStructureAccessError(
      "Запрошенная группа не относится к указанному руководителю.",
      "FORBIDDEN",
    );
  }
  if (context.role === "rop" && context.employeeId?.toLowerCase() !== leaderGuid.toLowerCase()) {
    throw new OrgStructureAccessError("Нет доступа к ветке РОП.", "FORBIDDEN");
  }
  return loadV3TeamMemberGuids(leaderGuid, teamGuid);
}

export async function resolveV3ListTeamMemberGuids(
  context: AccessContext,
  teamGuid: string,
  leaderGuid: string,
  responsibleGuid?: string | null,
): Promise<string[]> {
  const memberGuids = await assertV3TeamTerritoryAccess(context, leaderGuid, teamGuid);
  if (responsibleGuid) {
    assertResponsibleInTeamMembers(responsibleGuid, memberGuids);
  }
  return memberGuids;
}

export function assertResponsibleInTeamMembers(
  responsibleGuid: string,
  memberGuids: string[],
): void {
  const ok = memberGuids.some((guid) => guid.toLowerCase() === responsibleGuid.toLowerCase());
  if (!ok) {
    throw new OrgStructureAccessError("Сотрудник не входит в выбранную команду.", "FORBIDDEN");
  }
}

export function appendV3TeamMemberAssignmentUnionSql(
  alias: string,
  memberGuids: string[],
  params: unknown[],
): string {
  if (memberGuids.length === 0) {
    return " AND FALSE";
  }
  params.push(memberGuids);
  return ` AND ${memberAssignmentMatchSql(alias, `$${params.length}`)}`;
}

function memberAssignmentMatchSql(alias: string, membersParam: string): string {
  return `(
    NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidManager")}, '')), '')::uuid = ANY(${membersParam}::uuid[])
    OR NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidRegionalManager")}, '')), '')::uuid = ANY(${membersParam}::uuid[])
    OR NULLIF(TRIM(COALESCE(${v3JsonManagerField(alias, "guidHardwareManager")}, '')), '')::uuid = ANY(${membersParam}::uuid[])
  )`;
}

export async function countDistinctV3TeamPortfolio(
  context: AccessContext,
  memberGuids: string[],
): Promise<{ legal: number; retail: number }> {
  if (memberGuids.length === 0) {
    return { legal: 0, retail: 0 };
  }
  const leScope = v3EntityAssignmentScope(context, "le", "legal");
  const roScope = v3EntityAssignmentScope(context, "ro", "retail");
  const leParams = [...leScope.params, memberGuids];
  const membersIdxLe = leScope.params.length + 1;
  const groupKey = readableGroupKey(context, leParams);
  const roParams = [...roScope.params, memberGuids];
  const membersIdxRo = roScope.params.length + 1;
  const [legal, retail] = await Promise.all([
    query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count FROM (
          SELECT DISTINCT ${groupKey} AS group_key
          FROM onec_v3_legal_entities le
          WHERE (${leScope.clause}) AND ${memberAssignmentMatchSql("le", `$${membersIdxLe}`)}
        ) grouped
      `,
      leParams,
    ),
    query<{ count: string }>(
      `
        SELECT COUNT(DISTINCT ro.guid_store)::text AS count
        FROM onec_v3_retail_outlets ro
        WHERE (${roScope.clause}) AND ${memberAssignmentMatchSql("ro", `$${membersIdxRo}`)}
      `,
      roParams,
    ),
  ]);
  return {
    legal: Number(legal.rows[0]?.count ?? 0),
    retail: Number(retail.rows[0]?.count ?? 0),
  };
}

type RosterMemberRow = {
  employee_guid: string;
  name: string | null;
};

export async function queryV3AssignmentSummariesForMembers(
  context: AccessContext,
  memberGuids: string[],
): Promise<
  Array<{
    kind: "manager" | "regional" | "hardware";
    employee_guid: string;
    name: string | null;
    client_count: string;
    outlet_count: string;
  }>
> {
  if (memberGuids.length === 0) {
    return [];
  }
  const leScope = v3EntityAssignmentScope(context, "le", "legal");
  const roScope = v3EntityAssignmentScope(context, "ro", "retail");
  const leParams = [...leScope.params];
  const legalGroupKey = readableGroupKey(context, leParams);
  const leLen = leScope.params.length;
  const roLen = roScope.params.length;
  const roScopeOffset = leLen + 1;
  let roScopeClause = roScope.clause;
  if (roLen > 0) {
    roScopeClause = roScopeClause.replace(/\$(\d+)/g, (_match, index: string) => `$${Number(index) + roScopeOffset}`);
  }
  const membersIdx = leLen + roLen + 1;
  const sqlParams = [...leScope.params, ...roScope.params, memberGuids];

  const rows = await query<{
    kind: "manager" | "regional" | "hardware";
    employee_guid: string;
    name: string | null;
    client_count: string;
    outlet_count: string;
  }>(
    `
      WITH legal_mgr AS (
        SELECT 'manager'::text AS kind,
          lower(${v3JsonManagerField("le", "guidManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("le", "nameManager")}) AS name,
          COUNT(DISTINCT ${legalGroupKey})::text AS client_count, '0'::text AS outlet_count
        FROM onec_v3_legal_entities le
        WHERE (${leScope.clause})
          AND NULLIF(TRIM(${v3JsonManagerField("le", "guidManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("le", "guidManager")}), '')::uuid = ANY($${membersIdx}::uuid[])
        GROUP BY 2
      ),
      legal_reg AS (
        SELECT 'regional'::text AS kind,
          lower(${v3JsonManagerField("le", "guidRegionalManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("le", "nameRegionalManager")}) AS name,
          COUNT(DISTINCT ${legalGroupKey})::text AS client_count, '0'::text AS outlet_count
        FROM onec_v3_legal_entities le
        WHERE (${leScope.clause})
          AND NULLIF(TRIM(${v3JsonManagerField("le", "guidRegionalManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("le", "guidRegionalManager")}), '')::uuid = ANY($${membersIdx}::uuid[])
        GROUP BY 2
      ),
      legal_hw AS (
        SELECT 'hardware'::text AS kind,
          lower(${v3JsonManagerField("le", "guidHardwareManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("le", "nameHardwareManager")}) AS name,
          COUNT(DISTINCT ${legalGroupKey})::text AS client_count, '0'::text AS outlet_count
        FROM onec_v3_legal_entities le
        WHERE (${leScope.clause})
          AND NULLIF(TRIM(${v3JsonManagerField("le", "guidHardwareManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("le", "guidHardwareManager")}), '')::uuid = ANY($${membersIdx}::uuid[])
        GROUP BY 2
      ),
      retail_mgr AS (
        SELECT 'manager'::text AS kind,
          lower(${v3JsonManagerField("ro", "guidManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("ro", "nameManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM onec_v3_retail_outlets ro
        WHERE (${roScopeClause})
          AND NULLIF(TRIM(${v3JsonManagerField("ro", "guidManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("ro", "guidManager")}), '')::uuid = ANY($${membersIdx}::uuid[])
        GROUP BY 2
      ),
      retail_reg AS (
        SELECT 'regional'::text AS kind,
          lower(${v3JsonManagerField("ro", "guidRegionalManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("ro", "nameRegionalManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM onec_v3_retail_outlets ro
        WHERE (${roScopeClause})
          AND NULLIF(TRIM(${v3JsonManagerField("ro", "guidRegionalManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("ro", "guidRegionalManager")}), '')::uuid = ANY($${membersIdx}::uuid[])
        GROUP BY 2
      ),
      retail_hw AS (
        SELECT 'hardware'::text AS kind,
          lower(${v3JsonManagerField("ro", "guidHardwareManager")}) AS employee_guid,
          MAX(${v3JsonManagerField("ro", "nameHardwareManager")}) AS name,
          '0'::text AS client_count, COUNT(*)::text AS outlet_count
        FROM onec_v3_retail_outlets ro
        WHERE (${roScopeClause})
          AND NULLIF(TRIM(${v3JsonManagerField("ro", "guidHardwareManager")}), '') IS NOT NULL
          AND NULLIF(TRIM(${v3JsonManagerField("ro", "guidHardwareManager")}), '')::uuid = ANY($${membersIdx}::uuid[])
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
  return rows.rows;
}

export async function buildV3TeamResponsibleSummaries(
  context: AccessContext,
  linked: Set<string>,
  rosterMembers: RosterMemberRow[],
  memberGuids: string[],
): Promise<OrgResponsibleSummary[]> {
  const assignmentRows = await queryV3AssignmentSummariesForMembers(context, memberGuids);
  const byEmployeeKind = new Map<string, OrgResponsibleSummary>();
  for (const row of assignmentRows) {
    const key = `${row.employee_guid}:${row.kind}`;
    byEmployeeKind.set(key, {
      kind: row.kind,
      employeeGuid: row.employee_guid,
      name: row.name || row.employee_guid.slice(0, 8),
      shortId: shortUuidLabel(row.employee_guid),
      hasLinkedAccount: linked.has(row.employee_guid.toLowerCase()),
      rosterInOpt: true,
      clientCount: Number(row.client_count),
      outletCount: Number(row.outlet_count),
    });
  }

  const summaries: OrgResponsibleSummary[] = [];
  for (const member of rosterMembers) {
    const guid = member.employee_guid.toLowerCase();
    const memberRows = (["manager", "regional", "hardware"] as const)
      .map((kind) => byEmployeeKind.get(`${guid}:${kind}`))
      .filter((row): row is OrgResponsibleSummary => Boolean(row));
    const withPortfolio = memberRows.filter((row) => row.clientCount > 0 || row.outletCount > 0);
    if (withPortfolio.length === 0) {
      summaries.push({
        kind: "manager",
        employeeGuid: guid,
        name: member.name || guid.slice(0, 8),
        shortId: shortUuidLabel(guid),
        hasLinkedAccount: linked.has(guid),
        rosterInOpt: true,
        clientCount: 0,
        outletCount: 0,
      });
      continue;
    }
    summaries.push(...withPortfolio);
  }
  return summaries;
}
