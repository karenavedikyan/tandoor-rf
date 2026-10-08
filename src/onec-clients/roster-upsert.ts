import type { PoolClient } from "pg";
import type { WholesaleEmployeeRecord, WholesaleEmployeeRoster } from "./employee-roster";
import {
  buildExpectedTeamGroupsAfterApply,
  existingMembershipsForStoredRecord,
  resolveEmployeeTeamMemberships,
  type ExistingEmployeeTeamMembershipRow,
  type ExistingTeamGroupRow,
} from "./roster-team-memberships";
import {
  resolveRosterFieldValues,
  rosterRecordValuesEqual,
} from "./roster-field-values";

export type RosterUpsertCounts = {
  newCount: number;
  changedCount: number;
  unchangedCount: number;
};

export type ExistingRosterRow = {
  guid_manager: string;
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
  raw_json: Record<string, unknown>;
};

export async function loadExistingRoster(client: PoolClient): Promise<Map<string, ExistingRosterRow>> {
  const result = await client.query<ExistingRosterRow>(
    `
      SELECT
        guid_manager::text,
        name_manager,
        guid_post::text,
        post,
        guid_team::text,
        name_team,
        condition,
        date_of_assumption::text,
        guid_work_schedule::text,
        work_schedule,
        decree,
        email,
        telephone,
        raw_json
      FROM onec_wholesale_employee_roster
    `,
  );
  return new Map(result.rows.map((row) => [row.guid_manager.toLowerCase(), row]));
}

export async function loadExistingMembershipsByManager(
  client: PoolClient,
): Promise<Map<string, ExistingEmployeeTeamMembershipRow[]>> {
  const result = await client.query<ExistingEmployeeTeamMembershipRow & { guid_manager: string }>(
    `
      SELECT
        lower(guid_manager::text) AS guid_manager,
        lower(guid_team::text) AS guid_team,
        name_team
      FROM onec_wholesale_employee_team_memberships
      ORDER BY guid_team ASC
    `,
  );
  const map = new Map<string, ExistingEmployeeTeamMembershipRow[]>();
  for (const row of result.rows) {
    const key = row.guid_manager.toLowerCase();
    const list = map.get(key) ?? [];
    list.push({ guid_team: row.guid_team, name_team: row.name_team });
    map.set(key, list);
  }

  return map;
}

export async function loadExistingTeamGroups(client: PoolClient): Promise<ExistingTeamGroupRow[]> {
  const result = await client.query<ExistingTeamGroupRow>(
    `
      SELECT
        lower(guid_team::text) AS guid_team,
        name_team,
        lower(guid_team_leader::text) AS guid_team_leader,
        name_team_leader
      FROM onec_wholesale_team_groups
      ORDER BY guid_team ASC
    `,
  );
  return result.rows;
}

async function replaceEmployeeMemberships(
  client: PoolClient,
  managerGuid: string,
  memberships: ReturnType<typeof resolveEmployeeTeamMemberships>,
): Promise<void> {
  await client.query(`DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_manager = $1::uuid`, [
    managerGuid,
  ]);
  for (const membership of memberships) {
    await client.query(
      `
        INSERT INTO onec_wholesale_employee_team_memberships (
          guid_manager,
          guid_team,
          name_team,
          imported_at
        )
        VALUES ($1::uuid, $2::uuid, $3, NOW())
      `,
      [managerGuid, membership.guidTeam, membership.nameTeam],
    );
  }
}

export async function syncRosterTeamGroups(
  client: PoolClient,
  roster: WholesaleEmployeeRoster,
  membershipByManager: Map<string, ExistingEmployeeTeamMembershipRow[]>,
  existingGroups: ExistingTeamGroupRow[],
): Promise<void> {
  const drafts = buildExpectedTeamGroupsAfterApply(roster, membershipByManager, existingGroups);
  for (const draft of drafts.values()) {
    await client.query(
      `
        INSERT INTO onec_wholesale_team_groups (
          guid_team,
          name_team,
          guid_team_leader,
          name_team_leader,
          imported_at
        )
        VALUES ($1::uuid, $2, $3::uuid, $4, NOW())
        ON CONFLICT (guid_team) DO UPDATE SET
          name_team = EXCLUDED.name_team,
          guid_team_leader = EXCLUDED.guid_team_leader,
          name_team_leader = EXCLUDED.name_team_leader,
          imported_at = NOW()
      `,
      [
        draft.guidTeam,
        draft.nameTeam,
        draft.leader.guidTeamLeader,
        draft.leader.nameTeamLeader,
      ],
    );
  }
  await client.query(
    `
      DELETE FROM onec_wholesale_team_groups g
      WHERE NOT EXISTS (
        SELECT 1
        FROM onec_wholesale_employee_team_memberships m
        WHERE m.guid_team = g.guid_team
      )
    `,
  );
}

/**
 * Upsert wholesale employees from a regular update roster.
 * Employees absent from the file are retained; partial updates preserve omitted fields.
 */
export async function upsertWholesaleEmployeeRoster(
  client: PoolClient,
  roster: WholesaleEmployeeRoster,
): Promise<RosterUpsertCounts> {
  const existing = await loadExistingRoster(client);
  const existingMemberships = await loadExistingMembershipsByManager(client);
  const existingGroups = await loadExistingTeamGroups(client);
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const record of roster.records) {
    const key = record.guidManager.toLowerCase();
    const current = existing.get(key);
    const memberships = current
      ? existingMembershipsForStoredRecord(record, current, existingMemberships.get(key))
      : existingMemberships.get(key);
    if (!current) {
      newCount += 1;
    } else if (rosterRecordValuesEqual(current, record, memberships)) {
      unchangedCount += 1;
    } else {
      changedCount += 1;
    }

    const values = resolveRosterFieldValues(record, current, memberships);

    await client.query(
      `
        INSERT INTO onec_wholesale_employee_roster (
          guid_manager,
          name_manager,
          guid_post,
          post,
          guid_team,
          name_team,
          condition,
          date_of_assumption,
          guid_work_schedule,
          work_schedule,
          decree,
          email,
          telephone,
          raw_json,
          imported_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3::uuid,
          $4,
          $5::uuid,
          $6,
          $7,
          $8::timestamptz,
          $9::uuid,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb,
          NOW()
        )
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

    const resolvedMemberships = resolveEmployeeTeamMemberships(
      record,
      current ? existingMembershipsForStoredRecord(record, current, existingMemberships.get(key)) : memberships,
    );
    await replaceEmployeeMemberships(client, record.guidManager, resolvedMemberships);
    existingMemberships.set(key, resolvedMemberships.map((item) => ({
      guid_team: item.guidTeam,
      name_team: item.nameTeam,
    })));
  }

  await syncRosterTeamGroups(client, roster, existingMemberships, existingGroups);

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

  return { newCount, changedCount, unchangedCount };
}

export async function replaceWholesaleEmployeeRosterRecords(
  client: PoolClient,
  input: {
    sourceSha256: string;
    records: readonly WholesaleEmployeeRecord[];
    wholesaleCount: number;
  },
): Promise<number> {
  await client.query(`DELETE FROM onec_wholesale_employee_roster`);
  const roster: WholesaleEmployeeRoster = {
    wholesaleGuids: new Set(input.records.map((record) => record.guidManager.toLowerCase())),
    records: input.records,
    totalRecords: input.records.length,
    wholesaleCount: input.wholesaleCount,
    sourceSha256: input.sourceSha256,
    isEmpty: input.records.length === 0,
  };
  await upsertWholesaleEmployeeRoster(client, roster);
  return input.records.length;
}
