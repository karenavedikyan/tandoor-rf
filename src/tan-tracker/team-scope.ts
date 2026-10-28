import type { AccessContext } from "../access/types";
import { loadRopTeamEmployeeGuids } from "../access/rop-read-scope";
import { query } from "../db/pool";

/** Employee GUIDs whose transfers/contacts are visible for team-scoped roles. */
export async function loadTanTrackerTeamEmployeeGuids(
  access: AccessContext,
): Promise<Set<string> | null> {
  if (access.role === "director") {
    return null;
  }
  if (access.role === "admin") {
    return new Set();
  }
  const employeeId = access.employeeId;
  if (!employeeId) {
    return new Set();
  }
  if (access.role === "rop") {
    return loadRopTeamEmployeeGuids(access.userId, employeeId);
  }
  if (access.role === "regional_manager") {
    const result = await query<{ employee_guid: string }>(
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
