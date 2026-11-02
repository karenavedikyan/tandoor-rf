import type { AccessContext } from "../access/types";
import { loadRopTeamEmployeeGuids } from "../access/rop-read-scope";
import { query } from "../db/pool";
import type { PoolClient } from "pg";

/** Employee GUIDs whose transfers/contacts are visible for team-scoped roles. */
export async function loadTanTrackerTeamEmployeeGuids(
  access: AccessContext,
  client?: PoolClient,
): Promise<Set<string> | null> {
  if (access.role === "director" || access.role === "admin") {
    return null;
  }
  const employeeId = access.employeeId;
  if (!employeeId) {
    return new Set();
  }
  // Transactional bot readers must not acquire a second connection from the same pool.
  const run = (sql: string, params: unknown[]) => client
    ? client.query<{ employee_guid: string }>(sql, params)
    : query<{ employee_guid: string }>(sql, params);
  if (access.role === "rop") {
    const legacy = await loadRopTeamEmployeeGuids(access.userId, employeeId, client);
    const onecTeams = await run(
      `
        SELECT DISTINCT lower(m.guid_manager::text) AS employee_guid
        FROM onec_wholesale_team_groups g
        JOIN onec_wholesale_employee_team_memberships m ON m.guid_team = g.guid_team
        WHERE lower(g.guid_team_leader::text) = lower($1::text)
        UNION
        SELECT lower($1::text) AS employee_guid
      `,
      [employeeId],
    );
    const merged = new Set(legacy);
    for (const row of onecTeams.rows) {
      merged.add(row.employee_guid.toLowerCase());
    }
    return merged;
  }
  if (access.role === "regional_manager") {
    const result = await run(
      `
        SELECT m.guid_manager::text AS employee_guid
        FROM onec_wholesale_team_groups g
        JOIN onec_wholesale_employee_team_memberships m ON m.guid_team = g.guid_team
        WHERE lower(g.guid_team_leader::text) = lower($1::text)
        UNION
        SELECT $1::text AS employee_guid
      `,
      [employeeId],
    );
    return new Set(result.rows.map((r) => r.employee_guid.toLowerCase()));
  }
  return new Set([employeeId.toLowerCase()]);
}
