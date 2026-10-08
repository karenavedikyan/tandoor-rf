import type { WholesaleEmployeeRecord, WholesaleEmployeeRoster } from "./employee-roster";
import {
  buildExpectedTeamGroupsAfterApply,
  existingMembershipsToResolved,
  membershipsEqual,
  existingMembershipsForStoredRecord,
  resolveEmployeeTeamMemberships,
  resolveLegacyTeamColumnsForRecord,
  teamGroupsEqual,
  type ExistingEmployeeTeamMembershipRow,
  type ExistingTeamGroupRow,
} from "./roster-team-memberships";

export type ResolvedRosterFieldValues = {
  nameManager: string;
  guidPost: string | null;
  post: string | null;
  guidTeam: string | null;
  nameTeam: string | null;
  condition: string | null;
  dateOfAssumption: string | null;
  guidWorkSchedule: string | null;
  workSchedule: string | null;
  decree: string | null;
  email: string | null;
  telephone: string | null;
};

type ExistingRosterFieldValues = {
  name_manager: string;
  guid_post: string | null;
  post: string | null;
  guid_team: string | null;
  name_team: string | null;
  condition: string | null;
  date_of_assumption: string | null;
  guid_work_schedule: string | null;
  work_schedule: string | null;
  decree: string | null;
  email: string | null;
  telephone: string | null;
};

export function hasRosterRawKey(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

export function canonicalAssumptionTimestamptz(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function canonicalUuid(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() ?? null;
}

function resolveApplyValue<T>(
  raw: Record<string, unknown>,
  key: string,
  parsed: T | null,
  existing: T | null,
): T | null {
  if (hasRosterRawKey(raw, key)) {
    return parsed;
  }
  return existing;
}

/** Team pair: guid_team defines membership; name_team is display-only. */
export function resolveTeamFieldValues(
  raw: Record<string, unknown>,
  parsed: { guidTeam: string | null; nameTeam: string | null },
  existing: ExistingRosterFieldValues | undefined,
): { guidTeam: string | null; nameTeam: string | null } {
  const hasGuidKey = hasRosterRawKey(raw, "guid_team");
  const hasNameKey = hasRosterRawKey(raw, "name_team");
  const existingGuid = canonicalUuid(existing?.guid_team ?? null);
  const existingName = existing?.name_team ?? null;

  if (!hasGuidKey && !hasNameKey) {
    return { guidTeam: existingGuid, nameTeam: existingName };
  }

  if (hasGuidKey) {
    const newGuid = parsed.guidTeam;
    if (newGuid === null) {
      return { guidTeam: null, nameTeam: null };
    }
    if (!hasNameKey) {
      if (existingGuid === newGuid) {
        return { guidTeam: newGuid, nameTeam: existingName };
      }
      return { guidTeam: newGuid, nameTeam: null };
    }
    return { guidTeam: newGuid, nameTeam: parsed.nameTeam };
  }

  if (existingGuid === null) {
    return { guidTeam: null, nameTeam: existingName };
  }
  return { guidTeam: existingGuid, nameTeam: parsed.nameTeam };
}

export function resolveRosterFieldValues(
  record: WholesaleEmployeeRecord,
  existing: ExistingRosterFieldValues | undefined,
  existingMemberships?: ExistingEmployeeTeamMembershipRow[],
): ResolvedRosterFieldValues {
  const current = existing;
  const team =
    record.teams !== undefined
      ? resolveLegacyTeamColumnsForRecord(record, existingMemberships)
      : resolveTeamFieldValues(
          record.raw,
          { guidTeam: record.guidTeam, nameTeam: record.nameTeam },
          current,
        );
  return {
    nameManager: hasRosterRawKey(record.raw, "name_manager")
      ? record.nameManager
      : (current?.name_manager ?? ""),
    guidPost: resolveApplyValue(record.raw, "guid_post", record.guidPost, current?.guid_post ?? null),
    post: resolveApplyValue(record.raw, "post", record.post, current?.post ?? null),
    guidTeam: team.guidTeam,
    nameTeam: team.nameTeam,
    condition: resolveApplyValue(record.raw, "condition", record.condition, current?.condition ?? null),
    dateOfAssumption: resolveApplyValue(
      record.raw,
      "date_of_assumption",
      record.dateOfAssumption,
      current?.date_of_assumption ?? null,
    ),
    guidWorkSchedule: resolveApplyValue(
      record.raw,
      "guid_work_schedule",
      record.guidWorkSchedule,
      current?.guid_work_schedule ?? null,
    ),
    workSchedule: resolveApplyValue(
      record.raw,
      "work_schedule",
      record.workSchedule,
      current?.work_schedule ?? null,
    ),
    decree: resolveApplyValue(record.raw, "decree", record.decree, current?.decree ?? null),
    email: resolveApplyValue(record.raw, "email", record.email, current?.email ?? null),
    telephone: resolveApplyValue(record.raw, "telephone", record.telephone, current?.telephone ?? null),
  };
}

export function resolvedRosterValuesEqual(
  left: ResolvedRosterFieldValues,
  right: ResolvedRosterFieldValues,
): boolean {
  return (
    left.nameManager === right.nameManager &&
    canonicalUuid(left.guidPost) === canonicalUuid(right.guidPost) &&
    (left.post ?? null) === (right.post ?? null) &&
    canonicalUuid(left.guidTeam) === canonicalUuid(right.guidTeam) &&
    (left.nameTeam ?? null) === (right.nameTeam ?? null) &&
    (left.condition ?? null) === (right.condition ?? null) &&
    canonicalAssumptionTimestamptz(left.dateOfAssumption) ===
      canonicalAssumptionTimestamptz(right.dateOfAssumption) &&
    canonicalUuid(left.guidWorkSchedule) === canonicalUuid(right.guidWorkSchedule) &&
    (left.workSchedule ?? null) === (right.workSchedule ?? null) &&
    (left.decree ?? null) === (right.decree ?? null) &&
    (left.email ?? null) === (right.email ?? null) &&
    (left.telephone ?? null) === (right.telephone ?? null)
  );
}

export function existingRosterFieldValuesToResolved(
  existing: ExistingRosterFieldValues,
): ResolvedRosterFieldValues {
  return {
    nameManager: existing.name_manager,
    guidPost: existing.guid_post,
    post: existing.post,
    guidTeam: existing.guid_team,
    nameTeam: existing.name_team,
    condition: existing.condition,
    dateOfAssumption: existing.date_of_assumption,
    guidWorkSchedule: existing.guid_work_schedule,
    workSchedule: existing.work_schedule,
    decree: existing.decree,
    email: existing.email,
    telephone: existing.telephone,
  };
}

export function rosterRecordValuesEqual(
  existing: ExistingRosterFieldValues,
  record: WholesaleEmployeeRecord,
  existingMemberships?: ExistingEmployeeTeamMembershipRow[],
): boolean {
  const resolved = resolveRosterFieldValues(record, existing, existingMemberships);
  if (!resolvedRosterValuesEqual(resolved, existingRosterFieldValuesToResolved(existing))) {
    return false;
  }
  const incomingMemberships = resolveEmployeeTeamMemberships(record, existingMemberships);
  return membershipsEqual(
    incomingMemberships,
    existingMembershipsToResolved(existingMemberships ?? []),
  );
}

/** True when incoming roster would change persisted field values (including post-migration backfill). */
export function rosterIncomingDiffersFromStored(
  existingByManager: Map<string, ExistingRosterFieldValues>,
  existingMembershipsByManager: Map<string, ExistingEmployeeTeamMembershipRow[]>,
  existingGroups: ExistingTeamGroupRow[],
  roster: WholesaleEmployeeRoster,
): boolean {
  const expectedGroups = buildExpectedTeamGroupsAfterApply(
    roster,
    existingMembershipsByManager,
    existingGroups,
  );
  if (!teamGroupsEqual(existingGroups, expectedGroups)) {
    return true;
  }
  for (const record of roster.records) {
    const key = record.guidManager.toLowerCase();
    const current = existingByManager.get(key);
    const memberships = existingMembershipsForStoredRecord(
      record,
      {
        guid_team: current?.guid_team ?? null,
        name_team: current?.name_team ?? null,
      },
      existingMembershipsByManager.get(key),
    );
    if (!current || !rosterRecordValuesEqual(current, record, memberships)) {
      return true;
    }
  }
  return false;
}
