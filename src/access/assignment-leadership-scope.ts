import type { PoolClient } from "pg";
import { query } from "../db/pool";
import { v3RopTeamEmployeeGuidsSubquery } from "../clients/v3/access-scope";
import { AccessServiceError } from "./db";

/**
 * Operational assignment scope, not a client grant. Reuse the client registry's
 * current legacy + authoritative 1C team membership, with verified identities.
 * SQL arguments are trusted expressions supplied by server code, never input.
 */
export function ropAssignmentDelegatorClause(ropUserSql: string, delegatorUserSql: string): string {
  const employees = v3RopTeamEmployeeGuidsSubquery(ropUserSql, "assignment_leader_link.employee_id");
  return `EXISTS (
    SELECT 1 FROM user_onec_employee_links assignment_leader_link
    JOIN user_onec_employee_links assignment_member_link
      ON assignment_member_link.user_id = ${delegatorUserSql}::uuid
      AND assignment_member_link.revoked_at IS NULL
    WHERE assignment_leader_link.user_id = ${ropUserSql}::uuid
      AND assignment_leader_link.revoked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_onec_employee_links conflicting_link
        WHERE conflicting_link.revoked_at IS NULL
          AND conflicting_link.user_id <> assignment_leader_link.user_id
          AND conflicting_link.employee_id = assignment_leader_link.employee_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_onec_employee_links conflicting_member_link
        WHERE conflicting_member_link.revoked_at IS NULL
          AND conflicting_member_link.user_id <> assignment_member_link.user_id
          AND conflicting_member_link.employee_id = assignment_member_link.employee_id
      )
      AND assignment_member_link.employee_id IN (${employees})
  )`;
}

export async function assertAssignmentLeadershipScope(
  actor: { id: string; role: string },
  delegatorId: string,
  client?: PoolClient,
): Promise<void> {
  if (actor.role !== "rop") return;
  const sql = `SELECT 1 WHERE ${ropAssignmentDelegatorClause("$1", "$2")}`;
  const params = [actor.id, delegatorId];
  const result = client ? await client.query(sql, params) : await query(sql, params);
  if (!result.rowCount) {
    throw new AccessServiceError("Назначения доступны РОП только в своей текущей команде.", "FORBIDDEN");
  }
}
