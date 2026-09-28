import { query } from "../db/pool";

export async function listAccessOverview(): Promise<{
  users: unknown[];
  links: unknown[];
  grants: unknown[];
  teams: unknown[];
  coordinatorTeams: unknown[];
  delegations: unknown[];
  denials: unknown[];
  audit: unknown[];
}> {
  const [users, links, grants, teams, coordinatorTeams, delegations, denials, audit] =
    await Promise.all([
      query(
        `
          SELECT id::text, email, full_name, role, status
          FROM users
          ORDER BY email ASC
        `,
      ),
      query(
        `
          SELECT
            l.id::text,
            l.user_id::text,
            u.email AS user_email,
            u.full_name AS user_name,
            l.employee_id::text,
            l.basis,
            l.confirmed_at,
            l.revoked_at
          FROM user_onec_employee_links l
          JOIN users u ON u.id = l.user_id
          ORDER BY l.confirmed_at DESC
          LIMIT 200
        `,
      ),
      query(
        `
          SELECT
            g.id::text,
            g.user_id::text,
            u.email AS user_email,
            g.grant_type,
            g.object_id::text,
            oc.name_client AS client_name,
            g.basis,
            g.created_at,
            g.revoked_at
          FROM access_grants g
          JOIN users u ON u.id = g.user_id
          LEFT JOIN onec_clients oc ON oc.guid_client = g.object_id
          ORDER BY g.created_at DESC
          LIMIT 200
        `,
      ),
      query(
        `
          SELECT
            t.id::text,
            t.rop_user_id::text,
            rop.email AS rop_email,
            t.member_user_id::text,
            member.email AS member_email,
            t.basis,
            t.created_at,
            t.revoked_at
          FROM rop_team_members t
          JOIN users rop ON rop.id = t.rop_user_id
          JOIN users member ON member.id = t.member_user_id
          ORDER BY t.created_at DESC
          LIMIT 200
        `,
      ),
      query(
        `
          SELECT
            c.id::text,
            c.coordinator_user_id::text,
            coord.email AS coordinator_email,
            c.rop_user_id::text,
            rop.email AS rop_email,
            c.basis,
            c.created_at,
            c.revoked_at
          FROM coordinator_team_assignments c
          JOIN users coord ON coord.id = c.coordinator_user_id
          JOIN users rop ON rop.id = c.rop_user_id
          ORDER BY c.created_at DESC
          LIMIT 200
        `,
      ),
      query(
        `
          SELECT
            d.id::text,
            delegator.email AS delegator_email,
            assistant.email AS assistant_email,
            d.status,
            d.starts_at,
            d.ends_at,
            d.approved_at,
            d.revoked_at,
            approver.email AS approver_email,
            COALESCE(
              (
                SELECT json_agg(dc.guid_client::text ORDER BY dc.guid_client)
                FROM delegation_clients dc
                WHERE dc.delegation_id = d.id
              ),
              '[]'::json
            ) AS client_guids
          FROM delegations d
          JOIN users delegator ON delegator.id = d.delegator_user_id
          JOIN users assistant ON assistant.id = d.assistant_user_id
          LEFT JOIN users approver ON approver.id = d.business_approver_user_id
          ORDER BY d.created_at DESC
          LIMIT 200
        `,
      ),
      query(
        `
          SELECT
            d.id::text,
            u.email AS user_email,
            d.scope_type,
            d.object_id::text,
            d.reason,
            d.basis,
            d.created_at,
            d.revoked_at
          FROM access_denials d
          JOIN users u ON u.id = d.user_id
          ORDER BY d.created_at DESC
          LIMIT 200
        `,
      ),
      query(
        `
          SELECT
            a.id::text,
            actor.email AS actor_email,
            business.email AS business_actor_email,
            a.action,
            a.entity_type,
            a.entity_id::text,
            a.basis,
            a.created_at
          FROM access_audit_log a
          JOIN users actor ON actor.id = a.actor_user_id
          LEFT JOIN users business ON business.id = a.business_actor_user_id
          ORDER BY a.created_at DESC
          LIMIT 100
        `,
      ),
    ]);

  return {
    users: users.rows,
    links: links.rows,
    grants: grants.rows,
    teams: teams.rows,
    coordinatorTeams: coordinatorTeams.rows,
    delegations: delegations.rows,
    denials: denials.rows,
    audit: audit.rows,
  };
}
