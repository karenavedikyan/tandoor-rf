import { query } from "../db/pool";

/** User ids of colleagues on the same 1C wholesale team(s) as the actor (for contact picker). */
export async function loadWholesalePeerUserIds(
  userId: string,
  employeeId: string | null,
): Promise<string[]> {
  if (!employeeId) {
    return [userId];
  }
  const res = await query<{ user_id: string }>(
    `
      SELECT DISTINCT u.id::text AS user_id
      FROM user_onec_employee_links actor_link
      JOIN onec_wholesale_employee_team_memberships tm
        ON tm.guid_manager = actor_link.employee_id
      JOIN onec_wholesale_employee_team_memberships peer
        ON peer.guid_team = tm.guid_team
      JOIN user_onec_employee_links peer_link
        ON peer_link.employee_id = peer.guid_manager
       AND peer_link.revoked_at IS NULL
      JOIN users u ON u.id = peer_link.user_id AND u.status = 'active'
      WHERE actor_link.user_id = $1::uuid
        AND actor_link.revoked_at IS NULL
      UNION
      SELECT $1::text AS user_id
    `,
    [userId, employeeId],
  );
  return res.rows.map((r) => r.user_id);
}
