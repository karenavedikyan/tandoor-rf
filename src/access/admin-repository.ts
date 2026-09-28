import { query } from "../db/pool";
import { ACCESS_AUDIT_ACTIONS } from "./constants";

type AuditInput = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  basis?: string | null;
};

export async function writeAccessAudit(input: AuditInput): Promise<void> {
  await query(
    `
      INSERT INTO access_audit_log (
        actor_user_id, action, entity_type, entity_id, before_json, after_json, basis
      )
      VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb, $6::jsonb, $7)
    `,
    [
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.basis ?? null,
    ],
  );
}

export async function listAccessOverview(): Promise<{
  users: unknown[];
  links: unknown[];
  grants: unknown[];
  teams: unknown[];
  coordinatorTeams: unknown[];
  delegations: unknown[];
  audit: unknown[];
}> {
  const [users, links, grants, teams, coordinatorTeams, delegations, audit] = await Promise.all([
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
          l.employee_id::text,
          l.basis,
          l.confirmed_at,
          l.revoked_at
        FROM user_onec_employee_links l
        JOIN users u ON u.id = l.user_id
        ORDER BY l.confirmed_at DESC
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
          g.basis,
          g.created_at,
          g.revoked_at
        FROM access_grants g
        JOIN users u ON u.id = g.user_id
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
          d.delegator_user_id::text,
          delegator.email AS delegator_email,
          d.assistant_user_id::text,
          assistant.email AS assistant_email,
          d.status,
          d.starts_at,
          d.ends_at,
          d.approved_at,
          d.revoked_at,
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
        ORDER BY d.created_at DESC
        LIMIT 200
      `,
    ),
    query(
      `
        SELECT
          a.id::text,
          a.actor_user_id::text,
          actor.email AS actor_email,
          a.action,
          a.entity_type,
          a.entity_id::text,
          a.basis,
          a.created_at
        FROM access_audit_log a
        JOIN users actor ON actor.id = a.actor_user_id
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
    audit: audit.rows,
  };
}

export async function upsertEmployeeLink(input: {
  actorUserId: string;
  userId: string;
  employeeId: string;
  basis: string;
}): Promise<{ id: string }> {
  const existing = await query<{ id: string; employee_id: string }>(
    `
      SELECT id::text, employee_id::text
      FROM user_onec_employee_links
      WHERE user_id = $1::uuid AND revoked_at IS NULL
    `,
    [input.userId],
  );

  if (existing.rows[0]) {
    throw new Error("ACTIVE_LINK_EXISTS");
  }

  const conflict = await query<{ user_id: string }>(
    `
      SELECT user_id::text
      FROM user_onec_employee_links
      WHERE employee_id = $1::uuid AND revoked_at IS NULL
    `,
    [input.employeeId],
  );
  if (conflict.rows[0]) {
    throw new Error("EMPLOYEE_ID_CONFLICT");
  }

  const inserted = await query<{ id: string }>(
    `
      INSERT INTO user_onec_employee_links (
        user_id, employee_id, basis, confirmed_by_user_id
      )
      VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
      RETURNING id::text AS id
    `,
    [input.userId, input.employeeId, input.basis, input.actorUserId],
  );

  await writeAccessAudit({
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.EMPLOYEE_LINK_CREATE,
    entityType: "user_onec_employee_link",
    entityId: inserted.rows[0]!.id,
    after: {
      userId: input.userId,
      employeeId: input.employeeId,
      basis: input.basis,
    },
    basis: input.basis,
  });

  return { id: inserted.rows[0]!.id };
}

export async function createAccessGrant(input: {
  actorUserId: string;
  userId: string;
  objectId: string;
  basis: string;
}): Promise<{ id: string }> {
  const inserted = await query<{ id: string }>(
    `
      INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
      VALUES ($1::uuid, 'client', $2::uuid, $3, $4::uuid)
      RETURNING id::text AS id
    `,
    [input.userId, input.objectId, input.basis, input.actorUserId],
  );

  await writeAccessAudit({
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.GRANT_CREATE,
    entityType: "access_grant",
    entityId: inserted.rows[0]!.id,
    after: input,
    basis: input.basis,
  });

  return { id: inserted.rows[0]!.id };
}

export async function addRopTeamMember(input: {
  actorUserId: string;
  ropUserId: string;
  memberUserId: string;
  basis: string;
}): Promise<{ id: string }> {
  const inserted = await query<{ id: string }>(
    `
      INSERT INTO rop_team_members (
        rop_user_id, member_user_id, basis, created_by_user_id
      )
      VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
      RETURNING id::text AS id
    `,
    [input.ropUserId, input.memberUserId, input.basis, input.actorUserId],
  );

  await writeAccessAudit({
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.ROP_TEAM_ADD,
    entityType: "rop_team_member",
    entityId: inserted.rows[0]!.id,
    after: input,
    basis: input.basis,
  });

  return { id: inserted.rows[0]!.id };
}

export async function createDelegation(input: {
  actorUserId: string;
  delegatorUserId: string;
  assistantUserId: string;
  clientGuids: string[];
  startsAt: string;
  endsAt: string;
  status: "draft" | "pending_approval" | "active";
  basis: string;
}): Promise<{ id: string }> {
  const inserted = await query<{ id: string }>(
    `
      INSERT INTO delegations (
        delegator_user_id,
        assistant_user_id,
        status,
        starts_at,
        ends_at,
        approved_by_user_id,
        approved_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4::timestamptz,
        $5::timestamptz,
        CASE WHEN $3 = 'active' THEN $6::uuid ELSE NULL END,
        CASE WHEN $3 = 'active' THEN NOW() ELSE NULL END
      )
      RETURNING id::text AS id
    `,
    [
      input.delegatorUserId,
      input.assistantUserId,
      input.status,
      input.startsAt,
      input.endsAt,
      input.actorUserId,
    ],
  );

  const delegationId = inserted.rows[0]!.id;
  for (const guid of input.clientGuids) {
    await query(
      `
        INSERT INTO delegation_clients (delegation_id, guid_client)
        VALUES ($1::uuid, $2::uuid)
      `,
      [delegationId, guid],
    );
  }

  await writeAccessAudit({
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.DELEGATION_CREATE,
    entityType: "delegation",
    entityId: delegationId,
    after: { ...input, clientGuids: input.clientGuids },
    basis: input.basis,
  });

  return { id: delegationId };
}

export async function approveDelegation(input: {
  actorUserId: string;
  delegationId: string;
  basis: string;
}): Promise<void> {
  const before = await query(
    "SELECT * FROM delegations WHERE id = $1::uuid",
    [input.delegationId],
  );
  await query(
    `
      UPDATE delegations
      SET
        status = 'active',
        approved_by_user_id = $2::uuid,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid AND status = 'pending_approval' AND revoked_at IS NULL
    `,
    [input.delegationId, input.actorUserId],
  );

  await writeAccessAudit({
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.DELEGATION_APPROVE,
    entityType: "delegation",
    entityId: input.delegationId,
    before: before.rows[0] ?? null,
    after: { status: "active" },
    basis: input.basis,
  });
}

export async function revokeDelegation(input: {
  actorUserId: string;
  delegationId: string;
  reason: string;
  basis: string;
}): Promise<void> {
  const before = await query(
    "SELECT * FROM delegations WHERE id = $1::uuid",
    [input.delegationId],
  );
  await query(
    `
      UPDATE delegations
      SET
        status = 'revoked',
        revoked_by_user_id = $2::uuid,
        revoked_at = NOW(),
        revoke_reason = $3,
        updated_at = NOW()
      WHERE id = $1::uuid AND revoked_at IS NULL
    `,
    [input.delegationId, input.actorUserId, input.reason],
  );

  await writeAccessAudit({
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.DELEGATION_REVOKE,
    entityType: "delegation",
    entityId: input.delegationId,
    before: before.rows[0] ?? null,
    after: { status: "revoked", reason: input.reason },
    basis: input.basis,
  });
}
