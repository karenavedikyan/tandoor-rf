import { query } from "../db/pool";
import type { UserRole } from "../shared/user";
import { isClientReadRole } from "../shared/user";
import type { AccessContext } from "./types";

type LinkRow = { employee_id: string };
type ConflictRow = { employee_id: string; count: string };

export async function loadAccessContext(
  userId: string,
  role: UserRole,
): Promise<AccessContext> {
  if (role === "admin") {
    return {
      userId,
      role,
      employeeId: null,
      employeeLinkConflict: false,
      hasScopedClientAccess: true,
      fullClientBase: true,
    };
  }

  if (role === "director") {
    return {
      userId,
      role,
      employeeId: null,
      employeeLinkConflict: false,
      hasScopedClientAccess: true,
      fullClientBase: true,
    };
  }

  if (!isClientReadRole(role)) {
    return {
      userId,
      role,
      employeeId: null,
      employeeLinkConflict: false,
      hasScopedClientAccess: false,
      fullClientBase: false,
    };
  }

  const linkResult = await query<LinkRow>(
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
    const conflictResult = await query<ConflictRow>(
      `
        SELECT employee_id::text, COUNT(*)::text AS count
        FROM user_onec_employee_links
        WHERE revoked_at IS NULL AND employee_id = $1::uuid
        GROUP BY employee_id
        HAVING COUNT(*) > 1
      `,
      [employeeId],
    );
    employeeLinkConflict = conflictResult.rows.length > 0;
  }

  const needsLink = role === "manager" || role === "rop";
  const hasScopedClientAccess =
    !employeeLinkConflict &&
    (role === "assistant" ||
      role === "regional_manager" ||
      (needsLink ? employeeId !== null : true));

  return {
    userId,
    role,
    employeeId,
    employeeLinkConflict,
    hasScopedClientAccess,
    fullClientBase: false,
  };
}
