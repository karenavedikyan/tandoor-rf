import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { query } from "../db/pool";
import type { UserRole } from "../shared/user";
import { isClientReadRole } from "../shared/user";
import type { AccessContext } from "./types";

type UserRow = { role: UserRole; status: string };
type LinkRow = { employee_id: string };
type ConflictRow = { employee_id: string };
type DenialRow = { id: string };

async function runAccessQuery<T extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  params: unknown[],
): Promise<QueryResult<T>> {
  if (client) {
    return client.query<T>(text, params);
  }
  return query<T>(text, params);
}

export async function loadAccessContext(
  userId: string,
  role?: UserRole,
  client?: PoolClient,
): Promise<AccessContext> {
  const userResult = await runAccessQuery<UserRow>(
    client,
    "SELECT role, status FROM users WHERE id = $1::uuid",
    [userId],
  );
  const userRow = userResult.rows[0];
  const resolvedRole = role ?? userRow?.role ?? "manager";
  const status = (userRow?.status ?? "disabled") as AccessContext["status"];

  if (resolvedRole === "admin") {
    return {
      userId,
      role: resolvedRole,
      status,
      employeeId: null,
      employeeLinkConflict: false,
      hasEmployeeLink: false,
      hasScopedClientAccess: status === "active",
      fullClientBase: status === "active",
      explicitlyDeniedAll: false,
    };
  }

  if (status !== "active") {
    return {
      userId,
      role: resolvedRole,
      status,
      employeeId: null,
      employeeLinkConflict: false,
      hasEmployeeLink: false,
      hasScopedClientAccess: false,
      fullClientBase: false,
      explicitlyDeniedAll: false,
    };
  }

  const linkResult = await runAccessQuery<LinkRow>(
    client,
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE user_id = $1::uuid AND revoked_at IS NULL
      LIMIT 1
    `,
    [userId],
  );
  const employeeId = linkResult.rows[0]?.employee_id ?? null;

  let employeeLinkConflict = false;
  if (employeeId) {
    const conflictResult = await runAccessQuery<ConflictRow>(
      client,
      `
        SELECT employee_id::text
        FROM user_onec_employee_links
        WHERE revoked_at IS NULL AND employee_id = $1::uuid
        GROUP BY employee_id
        HAVING COUNT(*) > 1
      `,
      [employeeId],
    );
    employeeLinkConflict = conflictResult.rows.length > 0;
  }

  const denialAll = await runAccessQuery<DenialRow>(
    client,
    `
      SELECT id::text
      FROM access_denials
      WHERE user_id = $1::uuid
        AND scope_type = 'all_clients'
        AND revoked_at IS NULL
      LIMIT 1
    `,
    [userId],
  );
  const explicitlyDeniedAll = denialAll.rows.length > 0;

  const hasEmployeeLink = employeeId !== null && !employeeLinkConflict;
  const isReadRole = isClientReadRole(resolvedRole);

  let hasScopedClientAccess = false;
  let fullClientBase = false;

  if (isReadRole && hasEmployeeLink && !explicitlyDeniedAll) {
    if (resolvedRole === "director") {
      hasScopedClientAccess = true;
      fullClientBase = true;
    } else if (resolvedRole === "assistant" || resolvedRole === "regional_manager") {
      hasScopedClientAccess = true;
    } else if (resolvedRole === "manager" || resolvedRole === "rop") {
      hasScopedClientAccess = true;
    }
  }

  if (!isReadRole) {
    hasScopedClientAccess = false;
  }

  return {
    userId,
    role: resolvedRole,
    status,
    employeeId,
    employeeLinkConflict,
    hasEmployeeLink,
    hasScopedClientAccess,
    fullClientBase,
    explicitlyDeniedAll,
  };
}
