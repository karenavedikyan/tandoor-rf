import type { PoolClient } from "pg";
import { replaceWholesaleEmployeeRosterRecords } from "../onec-clients/roster-upsert";

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
    records: readonly import("../onec-clients/employee-roster").WholesaleEmployeeRecord[];
  },
): Promise<number> {
  return replaceWholesaleEmployeeRosterRecords(client, {
    sourceSha256: input.sourceSha256,
    records: input.records,
    wholesaleCount: input.records.length,
  });
}
