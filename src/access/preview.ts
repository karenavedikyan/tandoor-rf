import { query } from "../db/pool";
import { isClientReadRole, toUserDto, type UserDto, type UserRole } from "../shared/user";
import type { AccessContext } from "./types";

export const PREVIEW_ELIGIBLE_ROLES = ["manager", "regional_manager", "rop", "director"] as const;

export type PreviewEligibleRole = (typeof PREVIEW_ELIGIBLE_ROLES)[number];

export type PreviewTargetValidation =
  | {
      ok: true;
      user: UserDto;
      employeeId: string;
    }
  | {
      ok: false;
      code: "NOT_FOUND" | "DISABLED" | "INELIGIBLE_ROLE" | "NO_LINK" | "LINK_CONFLICT";
      message: string;
    };

export type PreviewErrorCode =
  | "NOT_FOUND"
  | "DISABLED"
  | "INELIGIBLE_ROLE"
  | "NO_LINK"
  | "LINK_CONFLICT";

export type PreviewErrorState = {
  code: PreviewErrorCode;
  message: string;
};

export type PreviewState =
  | {
      active: true;
      targetUser: UserDto;
      readOnly: true;
      error?: undefined;
    }
  | {
      active: true;
      targetUser: UserDto | null;
      readOnly: true;
      error: PreviewErrorState;
    }
  | {
      active: false;
    };

import type { AccessPreviewMeta } from "./types";

export type { AccessPreviewMeta };

function isPreviewEligibleRole(role: string): role is PreviewEligibleRole {
  return (PREVIEW_ELIGIBLE_ROLES as readonly string[]).includes(role);
}

export async function validatePreviewTarget(userId: string): Promise<PreviewTargetValidation> {
  const userResult = await query<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
  }>(
    `
      SELECT id::text, email, full_name, phone, role, status, last_login_at
      FROM users
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [userId],
  );
  const row = userResult.rows[0];
  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Пользователь не найден." };
  }
  if (row.status !== "active") {
    return { ok: false, code: "DISABLED", message: "Пользователь отключён. Просмотр недоступен." };
  }
  if (!isPreviewEligibleRole(row.role) || !isClientReadRole(row.role)) {
    return {
      ok: false,
      code: "INELIGIBLE_ROLE",
      message: "Просмотр доступен только для менеджера, регионального, РОПа или директора.",
    };
  }

  const linkResult = await query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE user_id = $1::uuid AND revoked_at IS NULL
      LIMIT 1
    `,
    [userId],
  );
  const employeeId = linkResult.rows[0]?.employee_id ?? null;
  if (!employeeId) {
    return {
      ok: false,
      code: "NO_LINK",
      message: "У пользователя нет подтверждённой связи с сотрудником 1С.",
    };
  }

  const conflictResult = await query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE revoked_at IS NULL AND employee_id = $1::uuid
      GROUP BY employee_id
      HAVING COUNT(*) > 1
    `,
    [employeeId],
  );
  if (conflictResult.rows.length > 0) {
    return {
      ok: false,
      code: "LINK_CONFLICT",
      message: "Связь сотрудника конфликтует. Просмотр недоступен.",
    };
  }

  return {
    ok: true,
    user: toUserDto(row),
    employeeId,
  };
}

export async function searchPreviewCandidates(queryText: string, limit = 20) {
  const result = await query<{
    id: string;
    email: string;
    full_name: string;
    role: UserRole;
    status: string;
    employee_id: string | null;
    link_conflict: boolean;
  }>(
    `
      SELECT
        u.id::text,
        u.email,
        u.full_name,
        u.role,
        u.status,
        l.employee_id::text,
        EXISTS (
          SELECT 1
          FROM user_onec_employee_links l2
          WHERE l2.revoked_at IS NULL
            AND l2.employee_id = l.employee_id
          GROUP BY l2.employee_id
          HAVING COUNT(*) > 1
        ) AS link_conflict
      FROM users u
      INNER JOIN user_onec_employee_links l
        ON l.user_id = u.id AND l.revoked_at IS NULL
      WHERE u.status = 'active'
        AND u.role = ANY($2::text[])
        AND (u.email ILIKE $1 OR u.full_name ILIKE $1)
      ORDER BY u.full_name ASC, u.email ASC
      LIMIT $3
    `,
    [`%${queryText.trim()}%`, PREVIEW_ELIGIBLE_ROLES, limit],
  );

  return result.rows
    .filter((row) => !row.link_conflict)
    .map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      employeeId: row.employee_id,
    }));
}

export async function loadPreviewTargetUserSnapshot(userId: string): Promise<UserDto | null> {
  const userResult = await query<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
  }>(
    `
      SELECT id::text, email, full_name, phone, role, status, last_login_at
      FROM users
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [userId],
  );
  const row = userResult.rows[0];
  return row ? toUserDto(row) : null;
}

export async function getSessionPreviewUserId(sessionId: string): Promise<string | null> {
  const result = await query<{ preview_user_id: string | null }>(
    `
      SELECT preview_user_id::text
      FROM sessions
      WHERE id = $1::uuid AND revoked_at IS NULL
      LIMIT 1
    `,
    [sessionId],
  );
  return result.rows[0]?.preview_user_id ?? null;
}

export async function setSessionPreviewUser(sessionId: string, targetUserId: string | null): Promise<void> {
  await query(
    `
      UPDATE sessions
      SET preview_user_id = $2::uuid
      WHERE id = $1::uuid AND revoked_at IS NULL
    `,
    [sessionId, targetUserId],
  );
}

export async function resolvePreviewState(sessionId: string | undefined): Promise<PreviewState> {
  if (!sessionId) {
    return { active: false };
  }
  const previewUserId = await getSessionPreviewUserId(sessionId);
  if (!previewUserId) {
    return { active: false };
  }
  const validation = await validatePreviewTarget(previewUserId);
  if (!validation.ok) {
    const targetUser = await loadPreviewTargetUserSnapshot(previewUserId);
    return {
      active: true,
      readOnly: true,
      targetUser,
      error: {
        code: validation.code,
        message: validation.message,
      },
    };
  }
  return {
    active: true,
    targetUser: validation.user,
    readOnly: true,
  };
}

export async function buildPreviewAccessContext(
  actorUserId: string,
  targetUserId: string,
  loadAccessContext: (userId: string, role?: UserRole) => Promise<AccessContext>,
): Promise<
  | { ok: true; context: AccessContext; preview: AccessPreviewMeta }
  | { ok: false; message: string }
> {
  const validation = await validatePreviewTarget(targetUserId);
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  const context = await loadAccessContext(targetUserId, validation.user.role);

  const preview: AccessPreviewMeta = {
    active: true,
    actorUserId,
    targetUserId,
    targetUser: validation.user,
    readOnly: true,
  };

  return {
    ok: true,
    context: { ...context, preview },
    preview,
  };
}
