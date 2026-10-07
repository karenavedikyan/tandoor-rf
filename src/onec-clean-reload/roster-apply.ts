import type { PoolClient } from "pg";
import type { WholesaleEmployeeRecord } from "../onec-clients/employee-roster";

export async function revokeEmployeeLinksOutsideRoster(
  client: PoolClient,
  rosterGuids: readonly string[],
): Promise<number> {
  const adminRow = await client.query<{ id: string }>(
    `SELECT id::text FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
  );
  const actorUserId = adminRow.rows[0]?.id ?? null;
  const result = await client.query(
    `
      UPDATE user_onec_employee_links
      SET revoked_at = NOW(),
          revoked_by_user_id = COALESCE(revoked_by_user_id, $2::uuid),
          revoke_reason = COALESCE(revoke_reason, 'Clean reload: employee absent from wholesale roster'),
          updated_at = NOW()
      WHERE revoked_at IS NULL
        AND NOT (employee_id = ANY($1::uuid[]))
    `,
    [rosterGuids, actorUserId],
  );
  return result.rowCount ?? 0;
}

export async function replaceWholesaleEmployeeRoster(
  client: PoolClient,
  input: {
    sourceSha256: string;
    records: readonly WholesaleEmployeeRecord[];
  },
): Promise<number> {
  await client.query(`DELETE FROM onec_wholesale_employee_roster`);

  for (const record of input.records) {
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
      `,
      [
        record.guidManager,
        record.nameManager,
        record.guidPost,
        record.post,
        record.guidTeam,
        record.nameTeam,
        record.condition,
        record.dateOfAssumption,
        record.guidWorkSchedule,
        record.workSchedule,
        record.decree,
        record.email,
        record.telephone,
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
    [input.sourceSha256, input.records.length],
  );

  return input.records.length;
}
