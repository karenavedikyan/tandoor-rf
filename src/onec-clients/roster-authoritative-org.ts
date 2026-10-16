import type { PoolClient } from "pg";
import type { WholesaleEmployeeRecord, WholesaleEmployeeRoster } from "./employee-roster";
import {
  collectRosterTeamGroupDrafts,
  detectTeamLeaderConflicts,
  resolveEmployeeTeamMemberships,
  resolveLegacyTeamColumnsForRecord,
  type RosterTeamGroupDraft,
} from "./roster-team-memberships";
import { loadExistingRoster, type ExistingRosterRow } from "./roster-upsert";
import { resolveRosterFieldValues } from "./roster-field-values";

export type AuthoritativeOrgValidationCode =
  | "EMPTY_SNAPSHOT"
  | "MISSING_TEAM_KEY"
  | "INVALID_TEAM_KEY"
  | "MISSING_TEAM_LEADER_EMPLOYEE"
  | "TEAM_NAME_CONFLICT"
  | "TEAM_LEADER_CONFLICT";

export type AuthoritativeOrgValidationFailure = {
  ok: false;
  code: AuthoritativeOrgValidationCode;
  message: string;
  details?: Record<string, unknown>;
};

export type AuthoritativeOrgValidationSuccess = {
  ok: true;
  teamGroupCount: number;
  membershipCount: number;
};

export type AuthoritativeOrgValidationResult =
  | AuthoritativeOrgValidationSuccess
  | AuthoritativeOrgValidationFailure;

/** Confirmed full org snapshot: every employee row must include explicit `team` (array, may be empty). */
export function validateAuthoritativeOrgRoster(roster: WholesaleEmployeeRoster): AuthoritativeOrgValidationResult {
  if (roster.isEmpty || roster.records.length === 0) {
    return { ok: false, code: "EMPTY_SNAPSHOT", message: "Authoritative org snapshot is empty." };
  }

  const leaderConflicts = detectTeamLeaderConflicts(roster.records);
  if (leaderConflicts.length > 0) {
    const first = leaderConflicts[0]!;
    return {
      ok: false,
      code: "TEAM_LEADER_CONFLICT",
      message: `Conflicting guid_team_leader values for team ${first.guidTeam}.`,
      details: { guidTeam: first.guidTeam, leaderGuids: first.leaderGuids },
    };
  }

  for (const record of roster.records) {
    if (record.teams === undefined) {
      return {
        ok: false,
        code: "MISSING_TEAM_KEY",
        message: `Employee ${record.guidManager} is missing required team[] in authoritative org snapshot.`,
      };
    }
    if (record.teams !== null && !Array.isArray(record.teams)) {
      return {
        ok: false,
        code: "INVALID_TEAM_KEY",
        message: `Employee ${record.guidManager} has invalid team[] type in authoritative org snapshot.`,
      };
    }
  }

  const drafts = collectRosterTeamGroupDrafts(roster.records);
  for (const [teamGuid, draft] of drafts) {
    const uniqueNames = [...new Set(draft.namesSeen.filter(Boolean))];
    if (uniqueNames.length > 1) {
      return {
        ok: false,
        code: "TEAM_NAME_CONFLICT",
        message: `Conflicting name_team values for team ${teamGuid}.`,
        details: { guidTeam: teamGuid, names: uniqueNames },
      };
    }
    if (draft.leader.guidTeamLeader) {
      const leaderKey = draft.leader.guidTeamLeader.toLowerCase();
      if (!roster.wholesaleGuids.has(leaderKey)) {
        return {
          ok: false,
          code: "MISSING_TEAM_LEADER_EMPLOYEE",
          message: `Team leader ${draft.leader.guidTeamLeader} for team ${teamGuid} is absent from employee snapshot.`,
          details: { guidTeam: teamGuid, guidTeamLeader: draft.leader.guidTeamLeader },
        };
      }
    }
  }

  let membershipCount = 0;
  for (const record of roster.records) {
    membershipCount += resolveEmployeeTeamMemberships(record, []).length;
  }

  return { ok: true, teamGroupCount: drafts.size, membershipCount };
}

export type AuthoritativeOrgApplyCounts = {
  employeesUpserted: number;
  employeesRetainedOutsideSnapshot: number;
  employeesRemovedOutsideSnapshot: number;
  membershipsWritten: number;
  teamGroupsWritten: number;
};

async function loadLinkedEmployeeGuids(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ employee_id: string }>(
    `SELECT lower(employee_id::text) AS employee_id FROM user_onec_employee_links WHERE revoked_at IS NULL`,
  );
  return new Set(result.rows.map((row) => row.employee_id));
}

async function upsertEmployeeRow(
  client: PoolClient,
  record: WholesaleEmployeeRecord,
  existing: ExistingRosterRow | undefined,
): Promise<void> {
  const memberships = resolveEmployeeTeamMemberships(record, []);
  const legacyTeam = resolveLegacyTeamColumnsForRecord(record, memberships.map((m) => ({
    guid_team: m.guidTeam,
    name_team: m.nameTeam,
  })));
  const values = resolveRosterFieldValues(record, existing, memberships.map((m) => ({
    guid_team: m.guidTeam,
    name_team: m.nameTeam,
  })));
  values.guidTeam = legacyTeam.guidTeam;
  values.nameTeam = legacyTeam.nameTeam;
  await client.query(
    `
      INSERT INTO onec_wholesale_employee_roster (
        guid_manager, name_manager, guid_post, post, guid_team, name_team,
        condition, date_of_assumption, guid_work_schedule, work_schedule,
        decree, email, telephone, raw_json, imported_at
      )
      VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6, $7, $8::timestamptz, $9::uuid, $10, $11, $12, $13, $14::jsonb, NOW())
      ON CONFLICT (guid_manager) DO UPDATE SET
        name_manager = EXCLUDED.name_manager,
        guid_post = EXCLUDED.guid_post,
        post = EXCLUDED.post,
        guid_team = EXCLUDED.guid_team,
        name_team = EXCLUDED.name_team,
        condition = EXCLUDED.condition,
        date_of_assumption = EXCLUDED.date_of_assumption,
        guid_work_schedule = EXCLUDED.guid_work_schedule,
        work_schedule = EXCLUDED.work_schedule,
        decree = EXCLUDED.decree,
        email = EXCLUDED.email,
        telephone = EXCLUDED.telephone,
        raw_json = EXCLUDED.raw_json,
        imported_at = NOW()
    `,
    [
      record.guidManager,
      values.nameManager,
      values.guidPost,
      values.post,
      values.guidTeam,
      values.nameTeam,
      values.condition,
      values.dateOfAssumption,
      values.guidWorkSchedule,
      values.workSchedule,
      values.decree,
      values.email,
      values.telephone,
      JSON.stringify(record.raw),
    ],
  );
}

async function writeTeamGroups(client: PoolClient, drafts: Map<string, RosterTeamGroupDraft>): Promise<number> {
  for (const draft of drafts.values()) {
    await client.query(
      `
        INSERT INTO onec_wholesale_team_groups (
          guid_team, name_team, guid_team_leader, name_team_leader, imported_at
        ) VALUES ($1::uuid, $2, $3::uuid, $4, NOW())
      `,
      [draft.guidTeam, draft.nameTeam, draft.leader.guidTeamLeader, draft.leader.nameTeamLeader],
    );
  }
  return drafts.size;
}

/**
 * Replace wholesale org projection (groups + memberships) from a validated authoritative snapshot.
 * Preserves roster rows for employees with active user links when absent from the file.
 * Does not touch users, links, grants, or client assignments.
 */
export async function applyAuthoritativeWholesaleOrgSnapshot(
  client: PoolClient,
  roster: WholesaleEmployeeRoster,
): Promise<AuthoritativeOrgApplyCounts> {
  const validation = validateAuthoritativeOrgRoster(roster);
  if (!validation.ok) {
    throw new Error(`${validation.code}: ${validation.message}`);
  }

  const snapshotGuids = roster.wholesaleGuids;
  const existing = await loadExistingRoster(client);
  const linked = await loadLinkedEmployeeGuids(client);

  let employeesRetainedOutsideSnapshot = 0;
  let employeesRemovedOutsideSnapshot = 0;

  for (const [guid, row] of existing) {
    if (snapshotGuids.has(guid)) {
      continue;
    }
    if (linked.has(guid)) {
      employeesRetainedOutsideSnapshot += 1;
      await client.query(`DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_manager = $1::uuid`, [
        row.guid_manager,
      ]);
      await client.query(
        `
          UPDATE onec_wholesale_employee_roster
          SET guid_team = NULL, name_team = NULL, imported_at = NOW()
          WHERE guid_manager = $1::uuid
        `,
        [row.guid_manager],
      );
      continue;
    }
    employeesRemovedOutsideSnapshot += 1;
    await client.query(`DELETE FROM onec_wholesale_employee_roster WHERE guid_manager = $1::uuid`, [row.guid_manager]);
  }

  await client.query(`DELETE FROM onec_wholesale_employee_team_memberships`);
  await client.query(`DELETE FROM onec_wholesale_team_groups`);

  let membershipsWritten = 0;
  for (const record of roster.records) {
    await upsertEmployeeRow(client, record, existing.get(record.guidManager.toLowerCase()));
    const memberships = resolveEmployeeTeamMemberships(record, []);
    for (const membership of memberships) {
      await client.query(
        `
          INSERT INTO onec_wholesale_employee_team_memberships (guid_manager, guid_team, name_team, imported_at)
          VALUES ($1::uuid, $2::uuid, $3, NOW())
        `,
        [record.guidManager, membership.guidTeam, membership.nameTeam],
      );
      membershipsWritten += 1;
    }
  }

  const drafts = collectRosterTeamGroupDrafts(roster.records);
  const teamGroupsWritten = await writeTeamGroups(client, drafts);

  await client.query(
    `
      INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        employee_count = EXCLUDED.employee_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, roster.wholesaleCount],
  );

  return {
    employeesUpserted: roster.records.length,
    employeesRetainedOutsideSnapshot,
    employeesRemovedOutsideSnapshot,
    membershipsWritten,
    teamGroupsWritten,
  };
}

export function authoritativeOrgSnapshotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export type AuthoritativeOrgDryRunPlan = {
  rosterSourceSha256: string;
  employeeCount: number;
  teamGroupCount: number;
  membershipCount: number;
  employeesRetainedOutsideSnapshot: number;
  employeesRemovedOutsideSnapshot: number;
  previousTeamGroupCount: number;
  previousMembershipCount: number;
};

/** Read-only plan for dry-run reporting (no writes). */
export async function planAuthoritativeWholesaleOrgSnapshot(
  client: PoolClient,
  roster: WholesaleEmployeeRoster,
): Promise<AuthoritativeOrgDryRunPlan> {
  const validation = validateAuthoritativeOrgRoster(roster);
  if (!validation.ok) {
    throw new Error(`${validation.code}: ${validation.message}`);
  }

  const snapshotGuids = roster.wholesaleGuids;
  const existing = await loadExistingRoster(client);
  const linked = await loadLinkedEmployeeGuids(client);

  let employeesRetainedOutsideSnapshot = 0;
  let employeesRemovedOutsideSnapshot = 0;
  for (const guid of existing.keys()) {
    if (snapshotGuids.has(guid)) {
      continue;
    }
    if (linked.has(guid)) {
      employeesRetainedOutsideSnapshot += 1;
    } else {
      employeesRemovedOutsideSnapshot += 1;
    }
  }

  const prevGroups = Number(
    (await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onec_wholesale_team_groups`)).rows[0]
      ?.count ?? 0,
  );
  const prevMemberships = Number(
    (
      await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM onec_wholesale_employee_team_memberships`,
      )
    ).rows[0]?.count ?? 0,
  );

  return {
    rosterSourceSha256: roster.sourceSha256,
    employeeCount: roster.records.length,
    teamGroupCount: validation.teamGroupCount,
    membershipCount: validation.membershipCount,
    employeesRetainedOutsideSnapshot,
    employeesRemovedOutsideSnapshot,
    previousTeamGroupCount: prevGroups,
    previousMembershipCount: prevMemberships,
  };
}
