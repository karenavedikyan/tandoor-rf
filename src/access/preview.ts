import { query } from "../db/pool";
import { toUserDto, type UserDto, type UserRole } from "../shared/user";
import type { AccessContext } from "./types";

export const PREVIEW_ELIGIBLE_ROLES = ["manager", "regional_manager", "rop", "director", "assistant", "coordinator"] as const;

export type PreviewEligibleRole = (typeof PREVIEW_ELIGIBLE_ROLES)[number];

export type PreviewTargetValidation =
  | {
      ok: true;
      user: UserDto;
      employeeId: string | null;
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
      readOnly: boolean;
      workMode: boolean;
      workExpiresAt?: string | null;
      actorUserId: string;
      error?: undefined;
    }
  | {
      active: true;
      targetUser: UserDto | null;
      readOnly: true;
      workMode: false;
      actorUserId: string;
      error: PreviewErrorState;
    }
  | {
      active: false;
    };

export type SessionPreviewDetails = {
  previewUserId: string | null;
  actorUserId: string | null;
  workEnabled: boolean;
  workExpiresAt: Date | null;
};

const PREVIEW_WORK_TTL_HOURS = 8;

export function previewWorkExpiryDate(): Date {
  return new Date(Date.now() + PREVIEW_WORK_TTL_HOURS * 60 * 60 * 1000);
}

export async function getSessionPreviewDetails(sessionId: string): Promise<SessionPreviewDetails | null> {
  const result = await query<{
    preview_user_id: string | null;
    user_id: string;
    preview_work_enabled: boolean;
    preview_work_expires_at: Date | null;
  }>(
    `
      SELECT preview_user_id::text, user_id::text, preview_work_enabled, preview_work_expires_at
      FROM sessions
      WHERE id = $1::uuid AND revoked_at IS NULL
      LIMIT 1
    `,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const workExpired =
    row.preview_work_enabled &&
    row.preview_work_expires_at &&
    row.preview_work_expires_at.getTime() <= Date.now();
  if (workExpired && row.preview_user_id) {
    await query(
      `
        UPDATE sessions
        SET preview_work_enabled = false, preview_work_started_at = NULL, preview_work_expires_at = NULL
        WHERE id = $1::uuid
      `,
      [sessionId],
    );
  }
  const workEnabled =
    Boolean(row.preview_user_id && row.preview_work_enabled && !workExpired);
  return {
    previewUserId: row.preview_user_id,
    actorUserId: row.user_id,
    workEnabled,
    workExpiresAt: workEnabled && row.preview_work_expires_at ? row.preview_work_expires_at : null,
  };
}

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
  if (!isPreviewEligibleRole(row.role)) {
    return {
      ok: false,
      code: "INELIGIBLE_ROLE",
      message: "Выберите действующего сотрудника: менеджера, ассистента, РОА, регионального, РОПа или директора.",
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
  // ROA works across territories, without a client/1C employee scope.
  // Directors outside 1C need the same explicit grant as their real login.
  let unlinkedAllowed = row.role === "coordinator";
  if (!employeeId && row.role === "director") {
    const schema = await query("SELECT to_regclass('public.director_base_access_grants') AS present");
    if (schema.rows[0]?.present) {
      const grant = await query("SELECT 1 FROM director_base_access_grants WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
      unlinkedAllowed = Boolean(grant.rowCount);
    }
  }
  if (!employeeId && !unlinkedAllowed) {
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
  const trimmed = queryText.trim();
  const pattern = trimmed ? `%${trimmed}%` : "%";
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
      LEFT JOIN user_onec_employee_links l
        ON l.user_id = u.id AND l.revoked_at IS NULL
      WHERE u.status = 'active'
        AND u.role = ANY($2::text[])
        AND (u.email ILIKE $1 OR u.full_name ILIKE $1)
      ORDER BY u.full_name ASC, u.email ASC
      LIMIT $3
    `,
    [pattern, PREVIEW_ELIGIBLE_ROLES, limit],
  );

  const items: Array<{
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    employeeId: string | null;
    canSelect: boolean;
    blockReason: string | null;
  }> = [];

  for (const row of result.rows) {
    if (row.link_conflict) {
      items.push({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        employeeId: row.employee_id,
        canSelect: false,
        blockReason: "Связь сотрудника конфликтует. Просмотр недоступен.",
      });
      continue;
    }
    const validation = await validatePreviewTarget(row.id);
    items.push({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      employeeId: row.employee_id,
      canSelect: validation.ok,
      blockReason: validation.ok ? null : validation.message,
    });
  }

  return items;
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
  const details = await getSessionPreviewDetails(sessionId);
  if (!details?.previewUserId || !details.actorUserId) {
    return { active: false };
  }
  const previewUserId = details.previewUserId;
  const validation = await validatePreviewTarget(previewUserId);
  if (!validation.ok) {
    const targetUser = await loadPreviewTargetUserSnapshot(previewUserId);
    return {
      active: true,
      readOnly: true,
      workMode: false,
      actorUserId: details.actorUserId,
      targetUser,
      error: {
        code: validation.code,
        message: validation.message,
      },
    };
  }
  const workMode = details.workEnabled;
  return {
    active: true,
    targetUser: validation.user,
    readOnly: !workMode,
    workMode,
    workExpiresAt: details.workExpiresAt?.toISOString() ?? null,
    actorUserId: details.actorUserId,
  };
}

export async function buildPreviewAccessContext(
  actorUserId: string,
  targetUserId: string,
  loadAccessContext: (userId: string, role?: UserRole) => Promise<AccessContext>,
  sessionId?: string,
): Promise<
  | { ok: true; context: AccessContext; preview: AccessPreviewMeta }
  | { ok: false; message: string }
> {
  const validation = await validatePreviewTarget(targetUserId);
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  const context = await loadAccessContext(targetUserId, validation.user.role);

  const details = sessionId
    ? await getSessionPreviewDetails(sessionId)
    : null;
  const workMode = Boolean(details?.workEnabled && details.previewUserId === targetUserId);
  const preview: AccessPreviewMeta = {
    active: true,
    actorUserId,
    targetUserId,
    targetUser: validation.user,
    readOnly: !workMode,
    workMode,
    workExpiresAt: workMode && details?.workExpiresAt ? details.workExpiresAt.toISOString() : null,
  };

  return {
    ok: true,
    context: { ...context, preview },
    preview,
  };
}
