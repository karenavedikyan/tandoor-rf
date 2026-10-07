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

export type ProvisionState = "none" | "pending_delivery" | "delivered";

export type UserInspectResult = {
  email: string;
  exists: boolean;
  user: UserLookupRow | null;
  employeeLinks: EmployeeLinkSummary[];
  personalAudit: PersonalAuditEntry[];
  provisionState: ProvisionState;
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

async function loadProvisionAuditFlags(
  client: PoolClient,
  userId: string,
): Promise<{ hasCreate: boolean; hasDeliveryConfirmed: boolean }> {
  const result = await client.query<{ action: string }>(
    `
      SELECT action
      FROM access_audit_log
      WHERE entity_type = $2
        AND entity_id = $1::uuid
        AND action = ANY($3::text[])
    `,
    [
      userId,
      USER_AUDIT_ENTITY_TYPE,
      [
        ACCESS_AUDIT_ACTIONS.USER_CREATE,
        ACCESS_AUDIT_ACTIONS.USER_PROVISION_DELIVERY_CONFIRMED,
      ],
    ],
  );
  const actions = new Set(result.rows.map((row) => row.action));
  return {
    hasCreate: actions.has(ACCESS_AUDIT_ACTIONS.USER_CREATE),
    hasDeliveryConfirmed: actions.has(ACCESS_AUDIT_ACTIONS.USER_PROVISION_DELIVERY_CONFIRMED),
  };
}

/** Whether admin account was created but password delivery was never confirmed. */
export async function getProvisionStateForUser(
  client: PoolClient,
  user: UserLookupRow,
): Promise<ProvisionState> {
  if (user.role !== "admin") {
    return "none";
  }
  const flags = await loadProvisionAuditFlags(client, user.id);
  if (!flags.hasCreate) {
    return "delivered";
  }
  if (flags.hasDeliveryConfirmed) {
    return "delivered";
  }
  return "pending_delivery";
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
    return {
      email,
      exists: false,
      user: null,
      employeeLinks: [],
      personalAudit: [],
      provisionState: "none",
    };
  }
  const [employeeLinks, personalAudit, provisionState] = await Promise.all([
    loadEmployeeLinksForUser(client, user.id),
    loadPersonalAuditForUser(client, user.id),
    getProvisionStateForUser(client, user),
  ]);
  return { email, exists: true, user, employeeLinks, personalAudit, provisionState };
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
      mode: "created" | "delivery_resumed";
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

export type TransactionFinalizeOutcome = "committed" | "rolled_back" | "unknown";

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
    if (existing.role === "admin") {
      const provisionState = await getProvisionStateForUser(client, existing);
      if (provisionState === "pending_delivery") {
        const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();
        const passwordCheck = validatePasswordInput(temporaryPassword);
        if (!passwordCheck.ok) {
          return { ok: false, code: "VALIDATION_ERROR", message: passwordCheck.message };
        }
        const passwordHash = await hashPassword(temporaryPassword);
        await client.query(
          `
            UPDATE users
            SET
              password_hash = $2,
              full_name = $3,
              status = 'disabled',
              password_must_change = TRUE,
              updated_at = NOW()
            WHERE id = $1::uuid
          `,
          [existing.id, passwordHash, fullName],
        );
        await writeUserAudit({
          client,
          actorUserId: input.actorUserId,
          action: ACCESS_AUDIT_ACTIONS.USER_PROVISION_RECOVERY,
          entityId: existing.id,
          before: { status: existing.status, provision_state: "pending_delivery" },
          after: {
            status: "disabled",
            provision_state: "pending_delivery",
            password_must_change: true,
          },
          basis: `${basis} (восстановление незавершённой выдачи)`,
        });
        await writeUserAudit({
          client,
          actorUserId: input.actorUserId,
          action: ACCESS_AUDIT_ACTIONS.USER_PASSWORD_SET,
          entityId: existing.id,
          before: { password_set: true, delivery_confirmed: false },
          after: { password_set: true, delivery: "temporary", password_must_change: true },
          basis: `${basis} (новый временный пароль при восстановлении)`,
        });
        return {
          ok: true,
          mode: "delivery_resumed",
          userId: existing.id,
          email: existing.email,
          temporaryPassword,
        };
      }
      return {
        ok: false,
        code: "USER_ALREADY_ADMIN",
        message: "Пользователь с этим email уже является администратором.",
      };
    }
    if (existing.status === "disabled") {
      return {
        ok: false,
        code: "USER_DISABLED",
        message: "Учётная запись отключена; автоматическая выдача admin запрещена.",
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
      VALUES ($1, $2, $3, 'admin', 'disabled', TRUE)
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
      status: "disabled",
      password_must_change: true,
      pending_delivery: true,
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

let testFaultBeforeProvisionIncompleteAudit = false;

/** Test hook: simulate audit write failure when marking incomplete provision. */
export function setTestFaultBeforeProvisionIncompleteAudit(enabled: boolean): void {
  testFaultBeforeProvisionIncompleteAudit = enabled;
}

/** Keep account disabled after failed delivery; do not delete the user. */
export async function markAdminProvisionIncomplete(
  client: PoolClient,
  input: { userId: string; actorUserId: string; basis: string; reason: string },
): Promise<void> {
  await client.query(
    `
      UPDATE users
      SET status = 'disabled', updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [input.userId],
  );
  if (testFaultBeforeProvisionIncompleteAudit) {
    throw new Error("TEST_FAULT: provision incomplete audit write blocked");
  }
  await writeUserAudit({
    client,
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.USER_PROVISION_INCOMPLETE,
    entityId: input.userId,
    before: { status: "disabled" },
    after: { status: "disabled", reason: input.reason, pending_delivery: true },
    basis: `${input.basis} (${input.reason})`,
  });
}

/** Activate account only after password was delivered out-of-band. */
export async function confirmAdminProvisionDelivery(
  client: PoolClient,
  input: { userId: string; actorUserId: string; basis: string },
): Promise<void> {
  await client.query(
    `
      UPDATE users
      SET status = 'active', updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [input.userId],
  );
  await writeUserAudit({
    client,
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.USER_PROVISION_DELIVERY_CONFIRMED,
    entityId: input.userId,
    before: { status: "disabled", pending_delivery: true },
    after: { status: "active", pending_delivery: false },
    basis: `${input.basis} (доставка временного пароля подтверждена)`,
  });
}

/**
 * Commit grant transaction; if acknowledgment is lost, verify persistence separately.
 * ROLLBACK after an actual COMMIT does not prove the account was not created.
 */
export async function finalizeGrantTransaction(
  client: PoolClient,
  verifyClient: PoolClient,
  emailRaw: string,
): Promise<{ outcome: TransactionFinalizeOutcome; userExists: boolean }> {
  try {
    await client.query("COMMIT");
    return { outcome: "committed", userExists: true };
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection may be unusable after ambiguous COMMIT
    }
    const user = await lookupUserByEmail(verifyClient, emailRaw);
    if (user) {
      return { outcome: "unknown", userExists: true };
    }
    return { outcome: "rolled_back", userExists: false };
  }
}

/** @deprecated Use markAdminProvisionIncomplete — blind delete is unsafe for recovery. */
export async function rollbackProvisionedAdminUser(
  client: PoolClient,
  input: { userId: string; actorUserId: string; basis: string; reason: string },
): Promise<void> {
  await markAdminProvisionIncomplete(client, input);
}
