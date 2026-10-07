import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { hashPassword, validatePasswordInput } from "../auth/password";
import { normalizeEmail } from "../validation/email";
import { normalizeFullName } from "../validation/profile";
import type { UserRole } from "../shared/user";
import { ACCESS_AUDIT_ACTIONS } from "./constants";

export const USER_AUDIT_ENTITY_TYPE = "user";

export type UserLookupRow = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: string;
  password_must_change: boolean;
  created_at: Date;
  last_login_at: Date | null;
};

export type EmployeeLinkSummary = {
  employee_id: string;
  basis: string;
  confirmed_at: Date;
};

export type PersonalAuditEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  basis: string | null;
  actor_email: string;
  created_at: Date;
};

export type UserInspectResult = {
  email: string;
  exists: boolean;
  user: UserLookupRow | null;
  employeeLinks: EmployeeLinkSummary[];
  personalAudit: PersonalAuditEntry[];
};

type AuditWriteInput = {
  client: PoolClient;
  actorUserId: string;
  action: string;
  entityId: string;
  before: unknown;
  after: unknown;
  basis: string;
};

async function writeUserAudit(input: AuditWriteInput): Promise<void> {
  await input.client.query(
    `
      INSERT INTO access_audit_log (
        actor_user_id,
        business_actor_user_id,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        basis
      )
      VALUES ($1::uuid, NULL, $2, $3, $4::uuid, $5::jsonb, $6::jsonb, $7)
    `,
    [
      input.actorUserId,
      input.action,
      USER_AUDIT_ENTITY_TYPE,
      input.entityId,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.basis,
    ],
  );
}

export async function lookupUserByEmail(
  client: PoolClient,
  emailRaw: string,
): Promise<UserLookupRow | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) {
    return null;
  }
  const result = await client.query<UserLookupRow>(
    `
      SELECT
        id::text,
        email,
        full_name,
        role,
        status,
        password_must_change,
        created_at,
        last_login_at
      FROM users
      WHERE LOWER(BTRIM(email)) = $1
      LIMIT 1
    `,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function loadEmployeeLinksForUser(
  client: PoolClient,
  userId: string,
): Promise<EmployeeLinkSummary[]> {
  const result = await client.query<EmployeeLinkSummary>(
    `
      SELECT employee_id::text, basis, confirmed_at
      FROM user_onec_employee_links
      WHERE user_id = $1::uuid AND revoked_at IS NULL
      ORDER BY confirmed_at DESC
    `,
    [userId],
  );
  return result.rows;
}

/** Audit rows where the user is the subject (entity) or appears in before/after role changes. */
export async function loadPersonalAuditForUser(
  client: PoolClient,
  userId: string,
  limit = 20,
): Promise<PersonalAuditEntry[]> {
  const result = await client.query<PersonalAuditEntry>(
    `
      SELECT
        a.id::text,
        a.action,
        a.entity_type,
        a.entity_id::text,
        a.basis,
        actor.email AS actor_email,
        a.created_at
      FROM access_audit_log a
      JOIN users actor ON actor.id = a.actor_user_id
      WHERE a.entity_type = $2
        AND a.entity_id = $1::uuid
      ORDER BY a.created_at DESC
      LIMIT $3
    `,
    [userId, USER_AUDIT_ENTITY_TYPE, limit],
  );
  return result.rows;
}

export async function inspectUserByEmail(
  client: PoolClient,
  emailRaw: string,
): Promise<UserInspectResult> {
  const email = normalizeEmail(emailRaw);
  if (!email) {
    throw new Error("Укажите корректный email.");
  }
  const user = await lookupUserByEmail(client, email);
  if (!user) {
    return { email, exists: false, user: null, employeeLinks: [], personalAudit: [] };
  }
  const [employeeLinks, personalAudit] = await Promise.all([
    loadEmployeeLinksForUser(client, user.id),
    loadPersonalAuditForUser(client, user.id),
  ]);
  return { email, exists: true, user, employeeLinks, personalAudit };
}

export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(24);
  let value = "";
  for (let i = 0; i < 20; i += 1) {
    value += alphabet[bytes[i]! % alphabet.length];
  }
  const check = validatePasswordInput(value);
  if (!check.ok) {
    return generateTemporaryPassword();
  }
  return value;
}

export type GrantAdminAccessInput = {
  email: string;
  fullName: string;
  actorUserId: string;
  basis: string;
  /** Explicit confirmation that personal audit was reviewed before grant. */
  auditReviewConfirmed: boolean;
  /** When user already exists with a non-admin role, promote without touching password. */
  assignAdminRoleOnly?: boolean;
  /** Generated on create; never logged by callers. */
  temporaryPassword?: string;
};

export type GrantAdminAccessResult =
  | {
      ok: true;
      mode: "created";
      userId: string;
      email: string;
      temporaryPassword: string;
    }
  | {
      ok: true;
      mode: "role_assigned";
      userId: string;
      email: string;
    }
  | {
      ok: false;
      code:
        | "AUDIT_NOT_CONFIRMED"
        | "USER_ALREADY_ADMIN"
        | "USER_EXISTS_USE_ASSIGN_FLAG"
        | "USER_DISABLED"
        | "ACTOR_NOT_ADMIN"
        | "VALIDATION_ERROR";
      message: string;
    };

async function assertActorIsAdmin(client: PoolClient, actorUserId: string): Promise<boolean> {
  const result = await client.query<{ role: string; status: string }>(
    `SELECT role, status FROM users WHERE id = $1::uuid`,
    [actorUserId],
  );
  const row = result.rows[0];
  return row?.role === "admin" && row.status === "active";
}

export async function grantAdminAccess(
  client: PoolClient,
  input: GrantAdminAccessInput,
): Promise<GrantAdminAccessResult> {
  if (!input.auditReviewConfirmed) {
    return {
      ok: false,
      code: "AUDIT_NOT_CONFIRMED",
      message:
        "Подтвердите просмотр персонального аудита (флаг auditReviewConfirmed / --confirm-audit-reviewed).",
    };
  }

  const email = normalizeEmail(input.email);
  const fullName = normalizeFullName(input.fullName);
  const basis = input.basis.trim();
  if (!email) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Укажите корректный email." };
  }
  if (!fullName) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Укажите корректное ФИО." };
  }
  if (basis.length < 10) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Основание (basis) должно содержать не менее 10 символов.",
    };
  }

  if (!(await assertActorIsAdmin(client, input.actorUserId))) {
    return {
      ok: false,
      code: "ACTOR_NOT_ADMIN",
      message: "Инициатор должен быть активным администратором.",
    };
  }

  const existing = await lookupUserByEmail(client, email);

  if (existing) {
    if (existing.status === "disabled") {
      return {
        ok: false,
        code: "USER_DISABLED",
        message: "Учётная запись отключена; автоматическая выдача admin запрещена.",
      };
    }
    if (existing.role === "admin") {
      return {
        ok: false,
        code: "USER_ALREADY_ADMIN",
        message: "Пользователь с этим email уже является администратором.",
      };
    }
    if (!input.assignAdminRoleOnly) {
      return {
        ok: false,
        code: "USER_EXISTS_USE_ASSIGN_FLAG",
        message:
          "Пользователь уже существует. Пароль не изменён. Для назначения admin без сброса пароля используйте --assign-admin-role.",
      };
    }

    const before = {
      role: existing.role,
      full_name: existing.full_name,
      status: existing.status,
    };
    await client.query(
      `
        UPDATE users
        SET role = 'admin', full_name = $2, updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [existing.id, fullName],
    );
    await writeUserAudit({
      client,
      actorUserId: input.actorUserId,
      action: ACCESS_AUDIT_ACTIONS.USER_ROLE_ASSIGN,
      entityId: existing.id,
      before,
      after: { role: "admin", full_name: fullName, status: existing.status },
      basis,
    });

    return {
      ok: true,
      mode: "role_assigned",
      userId: existing.id,
      email: existing.email,
    };
  }

  const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();
  const passwordCheck = validatePasswordInput(temporaryPassword);
  if (!passwordCheck.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: passwordCheck.message };
  }

  const passwordHash = await hashPassword(temporaryPassword);
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO users (
        email,
        password_hash,
        full_name,
        role,
        status,
        password_must_change
      )
      VALUES ($1, $2, $3, 'admin', 'active', TRUE)
      RETURNING id::text
    `,
    [email, passwordHash, fullName],
  );
  const userId = inserted.rows[0]!.id;

  await writeUserAudit({
    client,
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.USER_CREATE,
    entityId: userId,
    before: null,
    after: {
      email,
      full_name: fullName,
      role: "admin",
      status: "active",
      password_must_change: true,
    },
    basis,
  });

  await writeUserAudit({
    client,
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.USER_PASSWORD_SET,
    entityId: userId,
    before: { password_set: false },
    after: { password_set: true, delivery: "temporary", password_must_change: true },
    basis: `${basis} (временный пароль, смена обязательна)`,
  });

  return {
    ok: true,
    mode: "created",
    userId,
    email,
    temporaryPassword,
  };
}

/** Remove a freshly provisioned user when password delivery failed after commit. */
export async function rollbackProvisionedAdminUser(
  client: PoolClient,
  input: { userId: string; actorUserId: string; basis: string; reason: string },
): Promise<void> {
  await writeUserAudit({
    client,
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.USER_PROVISION_ROLLBACK,
    entityId: input.userId,
    before: { status: "active" },
    after: { status: "rolled_back", reason: input.reason },
    basis: `${input.basis} (${input.reason})`,
  });
  await client.query(`DELETE FROM users WHERE id = $1::uuid`, [input.userId]);
}
