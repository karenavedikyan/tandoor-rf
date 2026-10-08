import type { AccessContext } from "../../access/types";
import { combineScopeAndFilter } from "../../access/combine-filters";
import { buildClientScopeSql } from "../../access/scope-sql";
import { query } from "../../db/pool";
import { shortUuidLabel } from "../uuid-param";
import { isValidNonZeroUuid } from "../../onec-clients/uuid";
import {
  ACTIVE_BASELINE_CLIENT_SQL,
  ACTIVE_BASELINE_OC_SQL,
} from "../../onec-clients/baseline-active-scope";
import { employeesDirectClientListClause } from "../team-portfolio-sql";
import { countUniqueOutletsForEmployeeGuids } from "./onec-team-portfolio";
import { loadDirectorSummary, loadLinkedAccountGuids, OrgStructureAccessError } from "./structure-repository";
import type { OrgDirectorSummary } from "./structure-repository";

/** URL/API token for employees without guid_team. */
export const ONEC_TEAM_UNDEFINED_KEY = "_undefined";

export type OrgOnecTeamNameStatus = "ok" | "missing" | "needs_clarification" | "undefined";

export type OrgOnecTeamLeaderStatus = "ok" | "no_account" | "unknown_roster" | "unset";

export type OrgOnecTeamLeader = {
  employeeGuid: string;
  name: string;
  shortId: string;
  hasLinkedAccount: boolean;
  status: OrgOnecTeamLeaderStatus;
};

export type OrgOnecTeamMember = {
  employeeGuid: string;
  name: string;
  shortId: string;
  rosterPost: string | null;
  hasLinkedAccount: boolean;
  clientCount: number;
  outletCount: number;
};

export type OrgOnecTeamGroup = {
  teamGuid: string | null;
  displayName: string;
  nameStatus: OrgOnecTeamNameStatus;
  memberCount: number;
  uniqueClientCount: number;
  uniqueOutletCount: number;
  leader: OrgOnecTeamLeader | null;
  members: OrgOnecTeamMember[];
};

export type OrgOnecTeamGroupSummary = {
  teamGuid: string | null;
  displayName: string;
  nameStatus: OrgOnecTeamNameStatus;
  memberCount: number;
  uniqueClientCount: number;
  uniqueOutletCount: number;
};

export type OrgOnecTeamsOverview = {
  director: OrgDirectorSummary | null;
  groups: OrgOnecTeamGroup[];
  allGroups: OrgOnecTeamGroupSummary[];
  rosterLoaded: boolean;
};

export type OrgOnecTeamsQuery = {
  q?: string;
  onecTeam?: string;
};

type MembershipRow = {
  employee_guid: string;
  name: string;
  post: string | null;
  team_guid: string;
  name_team: string | null;
};

type TeamGroupRow = {
  team_guid: string;
  name_team: string | null;
  leader_guid: string | null;
  leader_name: string | null;
};

export class OrgOnecTeamsSourceError extends Error {
  code: "ROSTER_NOT_LOADED";

  constructor(message: string) {
    super(message);
    this.code = "ROSTER_NOT_LOADED";
  }
}

function assertOnecTeamsAccess(context: AccessContext): void {
  if (context.status !== "active") {
    throw new OrgStructureAccessError("Аккаунт неактивен.", "FORBIDDEN");
  }
  if (context.employeeLinkConflict) {
    throw new OrgStructureAccessError("Конфликт привязки сотрудника 1С.", "FORBIDDEN");
  }
  if (context.role === "admin" || context.fullClientBase) {
    return;
  }
  if (context.role === "rop" && context.employeeId && context.hasEmployeeLink) {
    return;
  }
  throw new OrgStructureAccessError("Группы из 1С недоступны для вашей роли.", "FORBIDDEN");
}

async function loadRosterLoaded(): Promise<boolean> {
  const result = await query<{ employee_count: number }>(
    `SELECT employee_count FROM onec_wholesale_roster_state WHERE id = 1`,
  );
  return Number(result.rows[0]?.employee_count ?? 0) > 0;
}

async function loadMembershipRows(): Promise<MembershipRow[]> {
  const result = await query<MembershipRow>(
    `
      SELECT
        lower(m.guid_manager::text) AS employee_guid,
        r.name_manager AS name,
        r.post,
        lower(m.guid_team::text) AS team_guid,
        NULLIF(BTRIM(m.name_team), '') AS name_team
      FROM onec_wholesale_employee_team_memberships m
      JOIN onec_wholesale_employee_roster r ON r.guid_manager = m.guid_manager
      ORDER BY r.name_manager ASC, m.guid_manager ASC
    `,
  );
  return result.rows;
}

async function loadLegacyMembershipRows(): Promise<MembershipRow[]> {
  const result = await query<MembershipRow>(
    `
      SELECT
        lower(guid_manager::text) AS employee_guid,
        name_manager AS name,
        post,
        lower(guid_team::text) AS team_guid,
        NULLIF(BTRIM(name_team), '') AS name_team
      FROM onec_wholesale_employee_roster
      WHERE guid_team IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM onec_wholesale_employee_team_memberships m
          WHERE m.guid_manager = onec_wholesale_employee_roster.guid_manager
        )
      ORDER BY name_manager ASC, guid_manager ASC
    `,
  );
  return result.rows;
}

async function loadUngroupedMembershipRows(): Promise<MembershipRow[]> {
  const result = await query<MembershipRow>(
    `
      SELECT
        lower(r.guid_manager::text) AS employee_guid,
        r.name_manager AS name,
        r.post,
        NULL::text AS team_guid,
        NULL::text AS name_team
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
  return result.rows;
}

async function loadTeamGroupRows(): Promise<TeamGroupRow[]> {
  const result = await query<TeamGroupRow>(
    `
      SELECT
        lower(guid_team::text) AS team_guid,
        NULLIF(BTRIM(name_team), '') AS name_team,
        lower(guid_team_leader::text) AS leader_guid,
        NULLIF(BTRIM(name_team_leader), '') AS leader_name
      FROM onec_wholesale_team_groups
    `,
  );
  return result.rows;
}

async function loadRosterNameMap(): Promise<Map<string, string>> {
  const result = await query<{ guid_manager: string; name_manager: string }>(
    `SELECT lower(guid_manager::text) AS guid_manager, name_manager FROM onec_wholesale_employee_roster`,
  );
  return new Map(result.rows.map((row) => [row.guid_manager, row.name_manager]));
}

function scopedClientFilter(context: AccessContext, clientAlias = "onec_clients") {
  const scope = buildClientScopeSql(context);
  const scopedForAlias = {
    whereSql: scope.whereSql.replaceAll("onec_clients.", `${clientAlias}.`),
    params: scope.params,
  };
  const baselineSql =
    clientAlias === "oc"
      ? ACTIVE_BASELINE_OC_SQL
      : ACTIVE_BASELINE_CLIENT_SQL.replaceAll("onec_clients.", `${clientAlias}.`);
  const filter = combineScopeAndFilter(scopedForAlias, {
    whereSql: `WHERE ${baselineSql}`,
    params: [],
  });
  if (filter.whereSql === "WHERE FALSE") {
    return { whereSql: "WHERE FALSE", params: [], denied: true };
  }
  return { whereSql: filter.whereSql, params: filter.params, denied: false };
}

async function countUniqueClientsForEmployees(
  context: AccessContext,
  employeeGuids: string[],
): Promise<number> {
  if (employeeGuids.length === 0) {
    return 0;
  }
  const scoped = scopedClientFilter(context, "onec_clients");
  if (scoped.denied) {
    return 0;
  }
  const arrayParamIndex = scoped.params.length + 1;
  const portfolioClause = employeesDirectClientListClause(`$${arrayParamIndex}`, "onec_clients");
  const sql = `
      SELECT COUNT(DISTINCT onec_clients.guid_client)::text AS count
      FROM onec_clients
      ${scoped.whereSql}
        AND ${portfolioClause}
    `;
  const result = await query<{ count: string }>(sql, [...scoped.params, employeeGuids]);
  return Number(result.rows[0]?.count ?? "0");
}

async function countUniqueOutletsForEmployees(
  context: AccessContext,
  employeeGuids: string[],
): Promise<number> {
  return countUniqueOutletsForEmployeeGuids(context, employeeGuids);
}

async function countEmployeePortfolio(
  context: AccessContext,
  employeeGuid: string,
): Promise<{ clientCount: number; outletCount: number }> {
  const [clientCount, outletCount] = await Promise.all([
    countUniqueClientsForEmployees(context, [employeeGuid]),
    countUniqueOutletsForEmployees(context, [employeeGuid]),
  ]);
  return { clientCount, outletCount };
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function resolveGroupDisplayName(
  teamGuid: string | null,
  names: string[],
): { displayName: string; nameStatus: OrgOnecTeamNameStatus } {
  if (teamGuid === null) {
    return { displayName: "Без группы", nameStatus: "undefined" };
  }
  const distinct = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (distinct.length === 0) {
    return { displayName: "Группа без названия", nameStatus: "missing" };
  }
  if (distinct.length > 1) {
    return { displayName: "Название требует уточнения в 1С", nameStatus: "needs_clarification" };
  }
  return { displayName: distinct[0]!, nameStatus: "ok" };
}

function resolveLeader(
  teamGuid: string,
  groupRow: TeamGroupRow | undefined,
  linked: Set<string>,
  rosterNames: Map<string, string>,
): OrgOnecTeamLeader | null {
  const leaderGuid = groupRow?.leader_guid?.toLowerCase() ?? null;
  if (!leaderGuid || !isValidNonZeroUuid(leaderGuid)) {
    return null;
  }
  const rosterName = rosterNames.get(leaderGuid);
  const displayName = rosterName ?? groupRow?.leader_name ?? shortUuidLabel(leaderGuid);
  const status: OrgOnecTeamLeaderStatus = rosterName
    ? linked.has(leaderGuid)
      ? "ok"
      : "no_account"
    : "unknown_roster";
  return {
    employeeGuid: leaderGuid,
    name: displayName,
    shortId: shortUuidLabel(leaderGuid),
    hasLinkedAccount: linked.has(leaderGuid),
    status,
  };
}

function buildMember(
  row: MembershipRow,
  linked: Set<string>,
  portfolio: { clientCount: number; outletCount: number },
): OrgOnecTeamMember {
  return {
    employeeGuid: row.employee_guid,
    name: row.name,
    shortId: shortUuidLabel(row.employee_guid),
    rosterPost: row.post,
    hasLinkedAccount: linked.has(row.employee_guid),
    clientCount: portfolio.clientCount,
    outletCount: portfolio.outletCount,
  };
}

export async function buildOnecTeamGroups(
  rows: MembershipRow[],
  linked: Set<string>,
  groupRows: TeamGroupRow[],
  context: AccessContext,
): Promise<OrgOnecTeamGroup[]> {
  const groupMeta = new Map(groupRows.map((row) => [row.team_guid, row]));
  const rosterNames = await loadRosterNameMap();
  const buckets = new Map<string | null, { names: string[]; members: Map<string, OrgOnecTeamMember> }>();

  for (const row of rows) {
    const teamGuid =
      row.team_guid && isValidNonZeroUuid(row.team_guid) ? row.team_guid.toLowerCase() : null;
    if (!buckets.has(teamGuid)) {
      buckets.set(teamGuid, { names: [], members: new Map() });
    }
    const bucket = buckets.get(teamGuid)!;
    if (row.name_team) {
      bucket.names.push(row.name_team);
    }
  }

  for (const row of rows) {
    const teamGuid =
      row.team_guid && isValidNonZeroUuid(row.team_guid) ? row.team_guid.toLowerCase() : null;
    const bucket = buckets.get(teamGuid)!;
    const portfolio = await countEmployeePortfolio(context, row.employee_guid);
    bucket.members.set(row.employee_guid, buildMember(row, linked, portfolio));
  }

  const groups: OrgOnecTeamGroup[] = [];
  for (const [teamGuid, bucket] of buckets) {
    const meta = teamGuid ? groupMeta.get(teamGuid) : undefined;
    const leader = teamGuid ? resolveLeader(teamGuid, meta, linked, rosterNames) : null;
    const leaderGuid = leader?.employeeGuid ?? null;
    const members = [...bucket.members.values()]
      .filter((member) => member.employeeGuid !== leaderGuid)
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
    const memberGuids = [...bucket.members.keys()];
    const naming = resolveGroupDisplayName(teamGuid, bucket.names.length > 0 ? bucket.names : meta?.name_team ? [meta.name_team] : []);
    const uniqueClientCount = await countUniqueClientsForEmployees(context, memberGuids);
    const uniqueOutletCount = await countUniqueOutletsForEmployees(context, memberGuids);
    groups.push({
      teamGuid,
      displayName: naming.displayName,
      nameStatus: naming.nameStatus,
      memberCount: memberGuids.length,
      uniqueClientCount,
      uniqueOutletCount,
      leader,
      members,
    });
  }

  groups.sort((left, right) => {
    if (left.teamGuid === null) {
      return 1;
    }
    if (right.teamGuid === null) {
      return -1;
    }
    return left.displayName.localeCompare(right.displayName, "ru") || (left.teamGuid ?? "").localeCompare(right.teamGuid ?? "");
  });

  return groups;
}

function memberMatchesQuery(member: OrgOnecTeamMember, queryText: string): boolean {
  const haystack = normalizeQuery(`${member.name} ${member.shortId}`);
  return haystack.includes(queryText);
}

function leaderMatchesQuery(leader: OrgOnecTeamLeader | null, queryText: string): boolean {
  if (!leader) {
    return false;
  }
  const haystack = normalizeQuery(`${leader.name} ${leader.shortId}`);
  return haystack.includes(queryText);
}

function groupNameMatchesQuery(group: OrgOnecTeamGroup, queryText: string): boolean {
  return normalizeQuery(group.displayName).includes(queryText);
}

export function filterOnecTeamGroups(
  groups: OrgOnecTeamGroup[],
  input: OrgOnecTeamsQuery,
): OrgOnecTeamGroup[] {
  const queryText = normalizeQuery(input.q);
  const selectedTeam = input.onecTeam?.trim().toLowerCase() ?? "";

  let scoped = groups;
  if (selectedTeam) {
    if (selectedTeam === ONEC_TEAM_UNDEFINED_KEY) {
      scoped = groups.filter((group) => group.teamGuid === null);
    } else if (isValidNonZeroUuid(selectedTeam)) {
      scoped = groups.filter((group) => group.teamGuid === selectedTeam);
    }
  }

  if (!queryText) {
    return scoped.filter((group) => group.memberCount > 0 || group.leader);
  }

  return scoped
    .map((group) => {
      if (groupNameMatchesQuery(group, queryText) || leaderMatchesQuery(group.leader, queryText)) {
        return group;
      }
      const members = group.members.filter((member) => memberMatchesQuery(member, queryText));
      if (members.length === 0) {
        return null;
      }
      return {
        ...group,
        members,
        memberCount: members.length,
      };
    })
    .filter((group): group is OrgOnecTeamGroup => group !== null);
}

function filterGroupsForRop(context: AccessContext, groups: OrgOnecTeamGroup[]): OrgOnecTeamGroup[] {
  const own = context.employeeId?.toLowerCase();
  if (!own || context.role !== "rop") {
    return groups;
  }
  return groups.filter((group) => group.leader?.employeeGuid === own);
}

export async function getOnecTeamGroupsOverview(
  context: AccessContext,
  filters: OrgOnecTeamsQuery = {},
): Promise<OrgOnecTeamsOverview> {
  assertOnecTeamsAccess(context);

  const rosterLoaded = await loadRosterLoaded();
  if (!rosterLoaded) {
    throw new OrgOnecTeamsSourceError(
      "Справочник ОПТ не загружен. Повторите попытку после обновления данных 1С.",
    );
  }

  const linked = await loadLinkedAccountGuids();
  const director =
    context.role === "admin" || context.fullClientBase ? await loadDirectorSummary(linked) : null;
  const membershipRows = [
    ...(await loadMembershipRows()),
    ...(await loadLegacyMembershipRows()),
    ...(await loadUngroupedMembershipRows()),
  ];
  const groupRows = await loadTeamGroupRows();
  const allBuilt = await buildOnecTeamGroups(membershipRows, linked, groupRows, context);
  const visibleBuilt =
    context.role === "rop" ? filterGroupsForRop(context, allBuilt) : allBuilt;
  const allGroups = visibleBuilt.map((group) => ({
    teamGuid: group.teamGuid,
    displayName: group.displayName,
    nameStatus: group.nameStatus,
    memberCount: group.memberCount,
    uniqueClientCount: group.uniqueClientCount,
    uniqueOutletCount: group.uniqueOutletCount,
  }));
  const groups = filterOnecTeamGroups(visibleBuilt, filters);

  return {
    director,
    groups,
    allGroups,
    rosterLoaded: true,
  };
}
