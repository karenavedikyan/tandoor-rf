import { Pool } from "pg";
import { assertTestDatabaseUrl } from "../../src/shared/test-database-guard";

export async function linkUserToEmployee(input: {
  databaseUrl: string;
  userId: string;
  employeeId: string;
  confirmedByUserId: string;
  basis?: string;
}): Promise<void> {
  assertTestDatabaseUrl(input.databaseUrl, "linkUserToEmployee");
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO user_onec_employee_links (user_id, employee_id, basis, confirmed_by_user_id)
      VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
    `,
    [
      input.userId,
      input.employeeId,
      input.basis ?? "integration test",
      input.confirmedByUserId,
    ],
  );
  await pool.end();
}

export async function grantClientAccess(input: {
  databaseUrl: string;
  userId: string;
  objectId: string;
  grantedByUserId: string;
  basis?: string;
}): Promise<void> {
  assertTestDatabaseUrl(input.databaseUrl, "grantClientAccess");
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
      VALUES ($1::uuid, 'client', $2::uuid, $3, $4::uuid)
    `,
    [input.userId, input.objectId, input.basis ?? "integration test", input.grantedByUserId],
  );
  await pool.end();
}

export async function addRopTeamMember(input: {
  databaseUrl: string;
  ropUserId: string;
  memberUserId: string;
  createdByUserId: string;
  basis?: string;
}): Promise<void> {
  assertTestDatabaseUrl(input.databaseUrl, "addRopTeamMember");
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO rop_team_members (rop_user_id, member_user_id, basis, created_by_user_id)
      VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
    `,
    [
      input.ropUserId,
      input.memberUserId,
      input.basis ?? "integration test",
      input.createdByUserId,
    ],
  );
  await pool.end();
}

export async function createDelegationRecord(input: {
  databaseUrl: string;
  delegatorUserId: string;
  assistantUserId: string;
  clientGuids: string[];
  status: "draft" | "pending_approval" | "active" | "revoked" | "expired";
  startsAt: string;
  endsAt: string;
  approvedByUserId?: string | null;
  revokedAt?: string | null;
}): Promise<string> {
  assertTestDatabaseUrl(input.databaseUrl, "createDelegationRecord");
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO delegations (
        delegator_user_id,
        assistant_user_id,
        status,
        starts_at,
        ends_at,
        approved_by_user_id,
        approved_at,
        revoked_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4::timestamptz,
        $5::timestamptz,
        $6::uuid,
        CASE WHEN $6 IS NULL THEN NULL ELSE NOW() END,
        $7::timestamptz
      )
      RETURNING id::text AS id
    `,
    [
      input.delegatorUserId,
      input.assistantUserId,
      input.status,
      input.startsAt,
      input.endsAt,
      input.approvedByUserId ?? null,
      input.revokedAt ?? null,
    ],
  );
  const delegationId = result.rows[0]!.id;
  for (const guid of input.clientGuids) {
    await pool.query(
      `
        INSERT INTO delegation_clients (delegation_id, guid_client)
        VALUES ($1::uuid, $2::uuid)
      `,
      [delegationId, guid],
    );
  }
  await pool.end();
  return delegationId;
}
