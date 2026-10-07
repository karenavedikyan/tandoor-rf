import type { PoolClient } from "pg";
import type { WholesaleEmployeeRecord, WholesaleEmployeeRoster } from "./employee-roster";
import {
  resolveRosterFieldValues,
  rosterRecordValuesEqual,
} from "./roster-field-values";

export type RosterUpsertCounts = {
  newCount: number;
  changedCount: number;
  unchangedCount: number;
};

type ExistingRosterRow = {
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

async function loadExistingRoster(client: PoolClient): Promise<Map<string, ExistingRosterRow>> {
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

/**
 * Upsert wholesale employees from a regular update roster.
 * Employees absent from the file are retained; partial updates preserve omitted fields.
 */
export async function upsertWholesaleEmployeeRoster(
  client: PoolClient,
  roster: WholesaleEmployeeRoster,
): Promise<RosterUpsertCounts> {
  const existing = await loadExistingRoster(client);
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const record of roster.records) {
    const current = existing.get(record.guidManager.toLowerCase());
    if (!current) {
      newCount += 1;
    } else if (rosterRecordValuesEqual(current, record)) {
      unchangedCount += 1;
    } else {
      changedCount += 1;
    }

    const values = resolveRosterFieldValues(record, current);

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
  }

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
