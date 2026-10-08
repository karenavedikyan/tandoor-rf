import type { AccessContext } from "../../access/types";
import { query } from "../../db/pool";
import { shortUuidLabel } from "../uuid-param";
import { isValidNonZeroUuid } from "../../onec-clients/uuid";
import { loadDirectorSummary, loadLinkedAccountGuids, OrgStructureAccessError } from "./structure-repository";
import type { OrgDirectorSummary } from "./structure-repository";

/** URL/API token for employees without guid_team. */
export const ONEC_TEAM_UNDEFINED_KEY = "_undefined";

export type OrgOnecTeamNameStatus = "ok" | "missing" | "needs_clarification" | "undefined";

export type OrgOnecTeamMember = {
  employeeGuid: string;
  name: string;
  shortId: string;
  rosterPost: string | null;
  hasLinkedAccount: boolean;
};

export type OrgOnecTeamGroup = {
  teamGuid: string | null;
  displayName: string;
  nameStatus: OrgOnecTeamNameStatus;
  memberCount: number;
  members: OrgOnecTeamMember[];
};

export type OrgOnecTeamGroupSummary = {
  teamGuid: string | null;
  displayName: string;
  nameStatus: OrgOnecTeamNameStatus;
  memberCount: number;
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

type RosterTeamRow = {
  employee_guid: string;
  name: string;
  post: string | null;
  team_guid: string | null;
  name_team: string | null;
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
  throw new OrgStructureAccessError("Группы из 1С недоступны для вашей роли.", "FORBIDDEN");
}

async function loadRosterLoaded(): Promise<boolean> {
  const result = await query<{ employee_count: number }>(
    `SELECT employee_count FROM onec_wholesale_roster_state WHERE id = 1`,
  );
  return Number(result.rows[0]?.employee_count ?? 0) > 0;
}

async function loadRosterTeamRows(): Promise<RosterTeamRow[]> {
  const result = await query<RosterTeamRow>(
    `
      SELECT
        lower(guid_manager::text) AS employee_guid,
        name_manager AS name,
        post,
        lower(guid_team::text) AS team_guid,
        NULLIF(BTRIM(name_team), '') AS name_team
      FROM onec_wholesale_employee_roster
      ORDER BY name_manager ASC, guid_manager ASC
    `,
  );
  return result.rows;
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function resolveGroupDisplayName(
  teamGuid: string | null,
  names: string[],
): { displayName: string; nameStatus: OrgOnecTeamNameStatus } {
  if (teamGuid === null) {
    return { displayName: "Группа не определена", nameStatus: "undefined" };
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

function buildMember(row: RosterTeamRow, linked: Set<string>): OrgOnecTeamMember {
  return {
    employeeGuid: row.employee_guid,
    name: row.name,
    shortId: shortUuidLabel(row.employee_guid),
    rosterPost: row.post,
    hasLinkedAccount: linked.has(row.employee_guid),
  };
}

export function buildOnecTeamGroups(rows: RosterTeamRow[], linked: Set<string>): OrgOnecTeamGroup[] {
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
    bucket.members.set(row.employee_guid, buildMember(row, linked));
  }

  const groups: OrgOnecTeamGroup[] = [];
  for (const [teamGuid, bucket] of buckets) {
    const members = [...bucket.members.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
    const naming = resolveGroupDisplayName(teamGuid, bucket.names);
    groups.push({
      teamGuid,
      displayName: naming.displayName,
      nameStatus: naming.nameStatus,
      memberCount: members.length,
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
    return scoped.filter((group) => group.members.length > 0);
  }

  return scoped
    .map((group) => {
      if (groupNameMatchesQuery(group, queryText)) {
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
  const director = await loadDirectorSummary(linked);
  const rows = await loadRosterTeamRows();
  const allBuilt = buildOnecTeamGroups(rows, linked);
  const allGroups = allBuilt.map((group) => ({
    teamGuid: group.teamGuid,
    displayName: group.displayName,
    nameStatus: group.nameStatus,
    memberCount: group.memberCount,
  }));
  const groups = filterOnecTeamGroups(allBuilt, filters);

  return {
    director,
    groups,
    allGroups,
    rosterLoaded: true,
  };
}
