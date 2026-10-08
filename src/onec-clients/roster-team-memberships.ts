import type { WholesaleEmployeeRecord } from "./employee-roster";
import { hasRosterRawKey } from "./roster-field-values";
import { isNullUuid, isValidNonZeroUuid, normalizeUuid } from "./uuid";

export type WholesaleEmployeeTeamEntry = {
  guidTeam: string;
  nameTeam: string | null;
  guidTeamLeader: string | null;
  nameTeamLeader: string | null;
};

export type ResolvedEmployeeTeamMembership = {
  guidTeam: string;
  nameTeam: string | null;
};

export type RosterTeamLeaderDraft = {
  guidTeamLeader: string | null;
  nameTeamLeader: string | null;
};

export type RosterTeamGroupDraft = {
  guidTeam: string;
  nameTeam: string | null;
  leader: RosterTeamLeaderDraft;
  namesSeen: string[];
};

export type ExistingEmployeeTeamMembershipRow = {
  guid_team: string;
  name_team: string | null;
};

export type ExistingTeamGroupRow = {
  guid_team: string;
  name_team: string | null;
  guid_team_leader: string | null;
  name_team_leader: string | null;
};

type TeamFieldIssue = {
  field: string;
  code: "INVALID_TYPE" | "INVALID_UUID";
};

function readOptionalStringField(
  raw: Record<string, unknown>,
  key: string,
  issues: TeamFieldIssue[],
): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) {
    return null;
  }
  const value = raw[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ field: key, code: "INVALID_TYPE" });
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateTeamLeaderUuidField(
  raw: Record<string, unknown>,
  key: string,
  issues: TeamFieldIssue[],
): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) {
    return null;
  }
  const value = raw[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ field: key, code: "INVALID_TYPE" });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || isNullUuid(trimmed)) {
    return null;
  }
  if (!isValidNonZeroUuid(trimmed)) {
    issues.push({ field: key, code: "INVALID_UUID" });
    return null;
  }
  return normalizeUuid(trimmed);
}

function validateOptionalUuidField(
  raw: Record<string, unknown>,
  key: string,
  issues: TeamFieldIssue[],
): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) {
    return null;
  }
  const value = raw[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ field: key, code: "INVALID_TYPE" });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!isValidNonZeroUuid(trimmed)) {
    issues.push({ field: key, code: "INVALID_UUID" });
    return null;
  }
  return normalizeUuid(trimmed);
}

function parseEmployeeTeamArrayEntries(
  raw: Record<string, unknown>,
  issues: TeamFieldIssue[],
): WholesaleEmployeeTeamEntry[] | null {
  const value = raw.team;
  if (value === null || typeof value !== "object" || !Array.isArray(value)) {
    issues.push({ field: "team", code: "INVALID_TYPE" });
    return null;
  }
  const entries: WholesaleEmployeeTeamEntry[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      issues.push({ field: `team[${index}]`, code: "INVALID_TYPE" });
      continue;
    }
    const entryRaw = item as Record<string, unknown>;
    const guidTeam = validateOptionalUuidField(entryRaw, "guid_team", issues);
    if (!guidTeam) {
      issues.push({ field: `team[${index}].guid_team`, code: "INVALID_UUID" });
      continue;
    }
    entries.push({
      guidTeam,
      nameTeam: readOptionalStringField(entryRaw, "name_team", issues),
      guidTeamLeader: validateTeamLeaderUuidField(entryRaw, "guid_team_leader", issues),
      nameTeamLeader: readOptionalStringField(entryRaw, "name_team_leader", issues),
    });
  }
  return entries;
}

export function detectIntraEmployeeTeamLeaderConflicts(
  entries: readonly WholesaleEmployeeTeamEntry[],
): TeamLeaderConflict[] {
  const leadersByTeam = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.guidTeamLeader) {
      continue;
    }
    const teamKey = entry.guidTeam.toLowerCase();
    const leaders = leadersByTeam.get(teamKey) ?? new Set<string>();
    leaders.add(entry.guidTeamLeader.toLowerCase());
    leadersByTeam.set(teamKey, leaders);
  }
  const conflicts: TeamLeaderConflict[] = [];
  for (const [guidTeam, leaders] of leadersByTeam) {
    if (leaders.size > 1) {
      conflicts.push({ guidTeam, leaderGuids: [...leaders].sort() });
    }
  }
  return conflicts;
}

export function parseEmployeeTeamArray(
  raw: Record<string, unknown>,
  issues: TeamFieldIssue[],
): WholesaleEmployeeTeamEntry[] | null | undefined | "LEADER_CONFLICT" {
  if (!hasRosterRawKey(raw, "team")) {
    return undefined;
  }
  const entries = parseEmployeeTeamArrayEntries(raw, issues);
  if (entries === null) {
    return null;
  }
  if (detectIntraEmployeeTeamLeaderConflicts(entries).length > 0) {
    return "LEADER_CONFLICT";
  }
  return dedupeTeamEntries(entries);
}

function dedupeTeamEntries(entries: WholesaleEmployeeTeamEntry[]): WholesaleEmployeeTeamEntry[] {
  const byGuid = new Map<string, WholesaleEmployeeTeamEntry>();
  for (const entry of entries) {
    byGuid.set(entry.guidTeam.toLowerCase(), entry);
  }
  return [...byGuid.values()].sort((left, right) => left.guidTeam.localeCompare(right.guidTeam));
}

export function legacyTeamEntries(record: WholesaleEmployeeRecord): WholesaleEmployeeTeamEntry[] {
  if (!record.guidTeam) {
    return [];
  }
  return [
    {
      guidTeam: record.guidTeam,
      nameTeam: record.nameTeam,
      guidTeamLeader: null,
      nameTeamLeader: null,
    },
  ];
}

/** Effective incoming team rows for one employee (explicit team[] overrides legacy pair). */
export function incomingTeamEntriesForRecord(record: WholesaleEmployeeRecord): {
  explicitTeamKey: boolean;
  entries: WholesaleEmployeeTeamEntry[];
} {
  const parsed = record.teams;
  if (parsed !== undefined) {
    return { explicitTeamKey: true, entries: parsed ?? [] };
  }
  return { explicitTeamKey: false, entries: legacyTeamEntries(record) };
}

export function existingMembershipsForStoredRecord(
  record: WholesaleEmployeeRecord,
  stored: { guid_team: string | null; name_team: string | null },
  tableMemberships: ExistingEmployeeTeamMembershipRow[] | undefined,
): ExistingEmployeeTeamMembershipRow[] {
  if ((tableMemberships?.length ?? 0) > 0) {
    return tableMemberships!;
  }
  if (record.teams !== undefined) {
    return [];
  }
  if (stored.guid_team) {
    return [{ guid_team: stored.guid_team, name_team: stored.name_team }];
  }
  return [];
}

export function resolveEmployeeTeamMemberships(
  record: WholesaleEmployeeRecord,
  existingMemberships: ExistingEmployeeTeamMembershipRow[] | undefined,
): ResolvedEmployeeTeamMembership[] {
  const incoming = incomingTeamEntriesForRecord(record);
  if (incoming.explicitTeamKey) {
    return incoming.entries.map((entry) => ({
      guidTeam: entry.guidTeam,
      nameTeam: entry.nameTeam,
    }));
  }
  const hasGuidKey = hasRosterRawKey(record.raw, "guid_team");
  const hasNameKey = hasRosterRawKey(record.raw, "name_team");
  if (hasGuidKey && record.guidTeam === null) {
    return [];
  }
  if (incoming.entries.length > 0) {
    return incoming.entries.map((entry) => ({
      guidTeam: entry.guidTeam,
      nameTeam: entry.nameTeam,
    }));
  }
  const existing = existingMemberships ?? [];
  if (hasNameKey && !hasGuidKey) {
    if (existing.length === 0) {
      return [];
    }
    return existing.map((row) => ({
      guidTeam: normalizeUuid(row.guid_team)!,
      nameTeam: record.nameTeam ?? row.name_team,
    }));
  }
  if (hasGuidKey && !hasNameKey) {
    const newGuid = record.guidTeam;
    if (!newGuid) {
      return [];
    }
    const prior = existing.find((row) => normalizeUuid(row.guid_team) === newGuid);
    return [{ guidTeam: newGuid, nameTeam: prior?.name_team ?? null }];
  }
  if (hasGuidKey && hasNameKey) {
    if (!record.guidTeam) {
      return [];
    }
    return [{ guidTeam: record.guidTeam, nameTeam: record.nameTeam }];
  }
  return existing.map((row) => ({
    guidTeam: normalizeUuid(row.guid_team)!,
    nameTeam: row.name_team,
  }));
}

function syncLegacyTeamColumns(
  memberships: ResolvedEmployeeTeamMembership[],
): { guidTeam: string | null; nameTeam: string | null } {
  if (memberships.length !== 1) {
    return { guidTeam: null, nameTeam: null };
  }
  return { guidTeam: memberships[0]!.guidTeam, nameTeam: memberships[0]!.nameTeam };
}

export function resolveLegacyTeamColumnsForRecord(
  record: WholesaleEmployeeRecord,
  existingMemberships: ExistingEmployeeTeamMembershipRow[] | undefined,
): { guidTeam: string | null; nameTeam: string | null } {
  const memberships = resolveEmployeeTeamMemberships(record, existingMemberships);
  return syncLegacyTeamColumns(memberships);
}

export type TeamLeaderConflict = {
  guidTeam: string;
  leaderGuids: string[];
};

export function detectTeamLeaderConflicts(
  records: readonly WholesaleEmployeeRecord[],
): TeamLeaderConflict[] {
  const leadersByTeam = new Map<string, Set<string>>();
  for (const record of records) {
    const incoming = incomingTeamEntriesForRecord(record);
    for (const entry of incoming.entries) {
      if (!entry.guidTeamLeader) {
        continue;
      }
      const teamKey = entry.guidTeam.toLowerCase();
      const leaders = leadersByTeam.get(teamKey) ?? new Set<string>();
      leaders.add(entry.guidTeamLeader.toLowerCase());
      leadersByTeam.set(teamKey, leaders);
    }
  }
  const conflicts: TeamLeaderConflict[] = [];
  for (const [guidTeam, leaders] of leadersByTeam) {
    if (leaders.size > 1) {
      conflicts.push({ guidTeam, leaderGuids: [...leaders].sort() });
    }
  }
  return conflicts;
}

export function collectRosterTeamGroupDrafts(
  records: readonly WholesaleEmployeeRecord[],
): Map<string, RosterTeamGroupDraft> {
  const groups = new Map<string, RosterTeamGroupDraft>();
  for (const record of records) {
    const incoming = incomingTeamEntriesForRecord(record);
    for (const entry of incoming.entries) {
      const teamKey = entry.guidTeam.toLowerCase();
      let group = groups.get(teamKey);
      if (!group) {
        group = {
          guidTeam: entry.guidTeam,
          nameTeam: entry.nameTeam,
          leader: { guidTeamLeader: null, nameTeamLeader: null },
          namesSeen: [],
        };
        groups.set(teamKey, group);
      }
      if (entry.nameTeam) {
        group.namesSeen.push(entry.nameTeam);
        if (!group.nameTeam) {
          group.nameTeam = entry.nameTeam;
        }
      }
      if (entry.guidTeamLeader && !group.leader.guidTeamLeader) {
        group.leader.guidTeamLeader = entry.guidTeamLeader;
        group.leader.nameTeamLeader = entry.nameTeamLeader;
      } else if (
        entry.guidTeamLeader &&
        group.leader.guidTeamLeader &&
        group.leader.guidTeamLeader.toLowerCase() === entry.guidTeamLeader.toLowerCase() &&
        entry.nameTeamLeader
      ) {
        group.leader.nameTeamLeader = group.leader.nameTeamLeader ?? entry.nameTeamLeader;
      }
    }
  }
  return groups;
}

export function membershipsEqual(
  left: ResolvedEmployeeTeamMembership[],
  right: ResolvedEmployeeTeamMembership[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const normalize = (items: ResolvedEmployeeTeamMembership[]) =>
    [...items]
      .map((item) => ({
        guidTeam: item.guidTeam.toLowerCase(),
        nameTeam: item.nameTeam ?? null,
      }))
      .sort((a, b) => a.guidTeam.localeCompare(b.guidTeam));
  const leftNorm = normalize(left);
  const rightNorm = normalize(right);
  return leftNorm.every(
    (item, index) =>
      item.guidTeam === rightNorm[index]?.guidTeam && item.nameTeam === rightNorm[index]?.nameTeam,
  );
}

export function existingMembershipsToResolved(
  rows: ExistingEmployeeTeamMembershipRow[],
): ResolvedEmployeeTeamMembership[] {
  return rows
    .map((row) => ({
      guidTeam: normalizeUuid(row.guid_team)!,
      nameTeam: row.name_team,
    }))
    .sort((left, right) => left.guidTeam.localeCompare(right.guidTeam));
}

export type TeamGroupsEqualInput = {
  guid_team: string;
  name_team: string | null;
  guid_team_leader: string | null;
  name_team_leader: string | null;
};

export function teamGroupsEqual(
  left: TeamGroupsEqualInput[],
  right: Map<string, RosterTeamGroupDraft>,
): boolean {
  const leftByTeam = new Map(left.map((row) => [row.guid_team.toLowerCase(), row]));
  if (leftByTeam.size !== right.size) {
    return false;
  }
  for (const [teamGuid, draft] of right) {
    const row = leftByTeam.get(teamGuid.toLowerCase());
    if (!row) {
      return false;
    }
    if ((row.name_team ?? null) !== (draft.nameTeam ?? null)) {
      return false;
    }
    if ((row.guid_team_leader ?? null)?.toLowerCase() !== (draft.leader.guidTeamLeader ?? null)?.toLowerCase()) {
      return false;
    }
    if ((row.name_team_leader ?? null) !== (draft.leader.nameTeamLeader ?? null)) {
      return false;
    }
  }
  return true;
}

export function buildExpectedTeamGroupsAfterApply(
  roster: import("./employee-roster").WholesaleEmployeeRoster,
  existingMembershipsByManager: Map<string, ExistingEmployeeTeamMembershipRow[]>,
  existingGroups: ExistingTeamGroupRow[],
): Map<string, RosterTeamGroupDraft> {
  const membershipByManager = new Map<string, ExistingEmployeeTeamMembershipRow[]>();
  for (const [managerGuid, rows] of existingMembershipsByManager) {
    membershipByManager.set(managerGuid, rows.map((row) => ({ ...row })));
  }
  for (const record of roster.records) {
    const key = record.guidManager.toLowerCase();
    const resolved = resolveEmployeeTeamMemberships(record, membershipByManager.get(key));
    membershipByManager.set(
      key,
      resolved.map((item) => ({ guid_team: item.guidTeam, name_team: item.nameTeam })),
    );
  }

  const activeTeamGuids = new Set<string>();
  for (const rows of membershipByManager.values()) {
    for (const row of rows) {
      activeTeamGuids.add(row.guid_team.toLowerCase());
    }
  }

  const incomingDrafts = collectRosterTeamGroupDrafts(roster.records);
  const existingByTeam = new Map(existingGroups.map((row) => [row.guid_team.toLowerCase(), row]));
  const expected = new Map<string, RosterTeamGroupDraft>();

  for (const teamGuid of activeTeamGuids) {
    const incoming = incomingDrafts.get(teamGuid);
    const existing = existingByTeam.get(teamGuid);
    if (incoming) {
      expected.set(teamGuid, incoming);
      continue;
    }
    const membershipNames = new Set<string>();
    for (const rows of membershipByManager.values()) {
      for (const row of rows) {
        if (row.guid_team.toLowerCase() === teamGuid && row.name_team?.trim()) {
          membershipNames.add(row.name_team.trim());
        }
      }
    }
    const nameTeam =
      membershipNames.size === 1
        ? [...membershipNames][0]!
        : membershipNames.size > 1
          ? null
          : (existing?.name_team ?? null);
    expected.set(teamGuid, {
      guidTeam: existing?.guid_team ?? teamGuid,
      nameTeam,
      leader: {
        guidTeamLeader: existing?.guid_team_leader ?? null,
        nameTeamLeader: existing?.name_team_leader ?? null,
      },
      namesSeen: nameTeam ? [nameTeam] : existing?.name_team ? [existing.name_team] : [],
    });
  }
  return expected;
}

export { TeamFieldIssue as RosterTeamFieldIssue };
