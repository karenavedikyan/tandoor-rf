import type { TransactionClient } from "./db";
import { AccessServiceError } from "./db";
import type { ActiveUserRow, DelegationRow } from "./types";

export async function getActiveUser(
  client: TransactionClient,
  userId: string,
): Promise<ActiveUserRow> {
  const result = await client.query<ActiveUserRow>(
    `
      SELECT id::text, email, full_name, role, status
      FROM users
      WHERE id = $1::uuid
    `,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AccessServiceError("Пользователь не найден.", "NOT_FOUND");
  }
  if (row.status !== "active") {
    throw new AccessServiceError("Учётная запись неактивна.", "FORBIDDEN");
  }
  return row;
}

export async function getEmployeeId(
  client: TransactionClient,
  userId: string,
): Promise<string> {
  const result = await client.query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE user_id = $1::uuid AND revoked_at IS NULL
      LIMIT 1
    `,
    [userId],
  );
  const employeeId = result.rows[0]?.employee_id;
  if (!employeeId) {
    throw new AccessServiceError("Нет подтверждённой связи с сотрудником 1С.", "FORBIDDEN");
  }
  return employeeId;
}

export async function assertClientsExist(
  client: TransactionClient,
  clientGuids: string[],
): Promise<void> {
  const result = await client.query<{ guid_client: string }>(
    `
      SELECT guid_client::text
      FROM onec_clients
      WHERE guid_client = ANY($1::uuid[])
    `,
    [clientGuids],
  );
  if (result.rows.length !== clientGuids.length) {
    throw new AccessServiceError(
      "Один или несколько клиентов не найдены в snapshot.",
      "VALIDATION",
    );
  }
}

export async function assertManagerOwnsClients(
  client: TransactionClient,
  managerUserId: string,
  clientGuids: string[],
): Promise<void> {
  const employeeId = await getEmployeeId(client, managerUserId);
  const result = await client.query<{ guid_client: string }>(
    `
      SELECT guid_client::text
      FROM onec_clients
      WHERE guid_client = ANY($1::uuid[])
        AND guid_manager = $2::uuid
    `,
    [clientGuids, employeeId],
  );
  if (result.rows.length !== clientGuids.length) {
    throw new AccessServiceError(
      "Передающий менеджер не имеет права на один или несколько клиентов.",
      "FORBIDDEN",
    );
  }
}

export async function ropManagesDelegator(
  client: TransactionClient,
  ropUserId: string,
  delegatorUserId: string,
): Promise<boolean> {
  if (ropUserId === delegatorUserId) {
    return true;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM rop_team_members
      WHERE rop_user_id = $1::uuid
        AND member_user_id = $2::uuid
        AND revoked_at IS NULL
      LIMIT 1
    `,
    [ropUserId, delegatorUserId],
  );
  return result.rows.length > 0;
}

export async function coordinatorAssignedToDelegatorTeam(
  client: TransactionClient,
  coordinatorUserId: string,
  delegatorUserId: string,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `
      SELECT cta.id::text
      FROM coordinator_team_assignments cta
      JOIN rop_team_members rtm
        ON rtm.rop_user_id = cta.rop_user_id
       AND rtm.revoked_at IS NULL
      WHERE cta.coordinator_user_id = $1::uuid
        AND cta.revoked_at IS NULL
        AND rtm.member_user_id = $2::uuid
      LIMIT 1
    `,
    [coordinatorUserId, delegatorUserId],
  );
  return result.rows.length > 0;
}

export async function canBusinessApproveDelegation(
  client: TransactionClient,
  approver: ActiveUserRow,
  delegatorUserId: string,
): Promise<boolean> {
  if (approver.role === "director") {
    return true;
  }
  if (approver.role === "rop") {
    return ropManagesDelegator(client, approver.id, delegatorUserId);
  }
  return false;
}

export async function getDelegationForUpdate(
  client: TransactionClient,
  delegationId: string,
): Promise<DelegationRow> {
  const result = await client.query<DelegationRow>(
    `
      SELECT
        id::text,
        delegator_user_id::text,
        assistant_user_id::text,
        status,
        starts_at,
        ends_at,
        approved_by_user_id::text,
        approved_at,
        business_approver_user_id::text,
        revoked_at,
        row_version
      FROM delegations
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [delegationId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AccessServiceError("Замещение не найдено.", "NOT_FOUND");
  }
  return row;
}
