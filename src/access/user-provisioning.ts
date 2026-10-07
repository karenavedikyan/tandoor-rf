import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { hashPassword, validatePasswordInput } from "../auth/password";
import { normalizeEmail } from "../validation/email";
import { normalizeFullName } from "../validation/profile";
import type { UserRole } from "../shared/user";
import { ACCESS_AUDIT_ACTIONS, PROVISION_OPERATION_ID_KEY } from "./constants";

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

export type PendingProvisionOperation = {
  operationId: string;
  mode: "created" | "delivery_resumed";
};

export type UserInspectResult = {
  email: string;
  exists: boolean;
  user: UserLookupRow | null;
  employeeLinks: EmployeeLinkSummary[];
  personalAudit: PersonalAuditEntry[];
  provisionState: ProvisionState;
  pendingOperation: PendingProvisionOperation | null;
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

export type ProvisionOperationMode = "created" | "delivery_resumed" | "role_assigned";

async function writeProvisionOperationCommitted(
  client: PoolClient,
  input: {
    operationId: string;
    actorUserId: string;
    entityId: string;
    mode: ProvisionOperationMode;
    basis: string;
    resumedOperationId?: string | null;
  },
): Promise<void> {
  await writeUserAudit({
    client,
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.USER_PROVISION_OPERATION_COMMITTED,
    entityId: input.entityId,
    before: null,
    after: {
      [PROVISION_OPERATION_ID_KEY]: input.operationId,
      mode: input.mode,
      resumed_operation_id: input.resumedOperationId ?? null,
    },
    basis: input.basis,
  });
}

async function writeProvisionOperationSuperseded(
  client: PoolClient,
  input: {
    actorUserId: string;
    entityId: string;
    supersededOperationId: string;
    supersededByOperationId: string;
    basis: string;
  },
): Promise<void> {
  await writeUserAudit({
    client,
    actorUserId: input.actorUserId,
    action: ACCESS_AUDIT_ACTIONS.USER_PROVISION_OPERATION_SUPERSEDED,
    entityId: input.entityId,
    before: {
      [PROVISION_OPERATION_ID_KEY]: input.supersededOperationId,
      pending_delivery: true,
    },
    after: {
      [PROVISION_OPERATION_ID_KEY]: input.supersededOperationId,
      superseded_by_operation_id: input.supersededByOperationId,
      pending_delivery: false,
    },
    basis: `${input.basis} (операция ${input.supersededOperationId} замещена ${input.supersededByOperationId})`,
  });
}

function isProvisionOperationClosedSql(committedAlias: string): string {
  return `
    (
      EXISTS (
        SELECT 1
        FROM access_audit_log delivered
        WHERE delivered.entity_id = ${committedAlias}.entity_id
          AND delivered.action = $5
          AND delivered.after_json->>$3 = ${committedAlias}.after_json->>$3
      )
      OR EXISTS (
        SELECT 1
        FROM access_audit_log superseded
        WHERE superseded.entity_id = ${committedAlias}.entity_id
          AND superseded.action = $6
          AND superseded.after_json->>$3 = ${committedAlias}.after_json->>$3
      )
      OR EXISTS (
        SELECT 1
        FROM access_audit_log successor
        WHERE successor.entity_id = ${committedAlias}.entity_id
          AND successor.action = $4
          AND successor.after_json->>'resumed_operation_id' = ${committedAlias}.after_json->>$3
      )
    )
  `;
}

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

/** Latest committed grant operation awaiting password delivery confirmation. */
export async function findPendingProvisionOperation(
  client: PoolClient,
  userId: string,
): Promise<PendingProvisionOperation | null> {
  const result = await client.query<{ operation_id: string; mode: string }>(
    `
      SELECT
        committed.after_json->>$3 AS operation_id,
        committed.after_json->>'mode' AS mode
      FROM access_audit_log committed
      WHERE committed.entity_type = $2
        AND committed.entity_id = $1::uuid
        AND committed.action = $4
        AND committed.after_json->>'mode' IN ('created', 'delivery_resumed')
        AND NOT ${isProvisionOperationClosedSql("committed")}
      ORDER BY committed.created_at DESC
      LIMIT 1
    `,
    [
      userId,
      USER_AUDIT_ENTITY_TYPE,
      PROVISION_OPERATION_ID_KEY,
      ACCESS_AUDIT_ACTIONS.USER_PROVISION_OPERATION_COMMITTED,
      ACCESS_AUDIT_ACTIONS.USER_PROVISION_DELIVERY_CONFIRMED,
      ACCESS_AUDIT_ACTIONS.USER_PROVISION_OPERATION_SUPERSEDED,
    ],
  );
  const row = result.rows[0];
  if (!row?.operation_id) {
    return null;
  }
  return {
    operationId: row.operation_id,
    mode: row.mode as PendingProvisionOperation["mode"],
  };
}

export async function isProvisionOperationCommitted(
  client: PoolClient,
  operationId: string,
): Promise<boolean> {
  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM access_audit_log
      WHERE action = $1
        AND after_json->>$2 = $3
    `,
    [
      ACCESS_AUDIT_ACTIONS.USER_PROVISION_OPERATION_COMMITTED,
      PROVISION_OPERATION_ID_KEY,
      operationId,
    ],
  );
  return Number(result.rows[0]?.count ?? "0") > 0;
}

/** Whether admin account was created but password delivery was never confirmed. */
export async function getProvisionStateForUser(
  client: PoolClient,
  user: UserLookupRow,
): Promise<ProvisionState> {
  if (user.role !== "admin") {
    return "none";
  }
  const pending = await findPendingProvisionOperation(client, user.id);
  if (pending) {
    return "pending_delivery";
  }
  return "delivered";
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
      pendingOperation: null,
    };
  }
  const [employeeLinks, personalAudit, provisionState, pendingOperation] = await Promise.all([
    loadEmployeeLinksForUser(client, user.id),
    loadPersonalAuditForUser(client, user.id),
    getProvisionStateForUser(client, user),
    findPendingProvisionOperation(client, user.id),
  ]);
  return {
    email,
    exists: true,
    user,
    employeeLinks,
    personalAudit,
    provisionState,
    pendingOperation,
  };
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
  /** Unique id for this grant attempt; verified atomically via audit after commit. */
  operationId: string;
  /** Pending operation being resumed (password redelivery). */
  resumeOperationId?: string | null;
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
      operationId: string;
      temporaryPassword: string;
    }
  | {
      ok: true;
      mode: "role_assigned";
      userId: string;
      email: string;
      operationId: string;
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

export type GrantOperationOutcome = {
  status: "committed" | "rolled_back" | "unknown";
  reason?: string;
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
    if (existing.role === "admin") {
      const pendingOperation = await findPendingProvisionOperation(client, existing.id);
      if (pendingOperation) {
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
          before: {
            status: existing.status,
            provision_state: "pending_delivery",
            [PROVISION_OPERATION_ID_KEY]: pendingOperation.operationId,
          },
          after: {
            status: "disabled",
            provision_state: "pending_delivery",
            password_must_change: true,
            [PROVISION_OPERATION_ID_KEY]: input.operationId,
            resumed_operation_id: input.resumeOperationId ?? pendingOperation.operationId,
          },
          basis: `${basis} (восстановление незавершённой выдачи)`,
        });
        await writeUserAudit({
          client,
          actorUserId: input.actorUserId,
          action: ACCESS_AUDIT_ACTIONS.USER_PASSWORD_SET,
          entityId: existing.id,
          before: {
            password_set: true,
            delivery_confirmed: false,
            [PROVISION_OPERATION_ID_KEY]: pendingOperation.operationId,
          },
          after: {
            password_set: true,
            delivery: "temporary",
            password_must_change: true,
            [PROVISION_OPERATION_ID_KEY]: input.operationId,
          },
          basis: `${basis} (новый временный пароль при восстановлении)`,
        });
        const resumedFrom = input.resumeOperationId ?? pendingOperation.operationId;
        await writeProvisionOperationCommitted(client, {
          operationId: input.operationId,
          actorUserId: input.actorUserId,
          entityId: existing.id,
          mode: "delivery_resumed",
          basis,
          resumedOperationId: resumedFrom,
        });
        await writeProvisionOperationSuperseded(client, {
          actorUserId: input.actorUserId,
          entityId: existing.id,
          supersededOperationId: resumedFrom,
          supersededByOperationId: input.operationId,
          basis,
        });
        return {
          ok: true,
          mode: "delivery_resumed",
          userId: existing.id,
          email: existing.email,
          operationId: input.operationId,
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
    await writeProvisionOperationCommitted(client, {
      operationId: input.operationId,
      actorUserId: input.actorUserId,
      entityId: existing.id,
      mode: "role_assigned",
      basis,
    });

    return {
      ok: true,
      mode: "role_assigned",
      userId: existing.id,
      email: existing.email,
      operationId: input.operationId,
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
    after: {
      password_set: true,
      delivery: "temporary",
      password_must_change: true,
      [PROVISION_OPERATION_ID_KEY]: input.operationId,
    },
    basis: `${basis} (временный пароль, смена обязательна)`,
  });
  await writeProvisionOperationCommitted(client, {
    operationId: input.operationId,
    actorUserId: input.actorUserId,
    entityId: userId,
    mode: "created",
    basis,
  });

  return {
    ok: true,
    mode: "created",
    userId,
    email,
    operationId: input.operationId,
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
  input: { userId: string; actorUserId: string; basis: string; operationId: string },
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
    after: {
      status: "active",
      pending_delivery: false,
      [PROVISION_OPERATION_ID_KEY]: input.operationId,
    },
    basis: `${input.basis} (доставка временного пароля подтверждена)`,
  });
}

let testSimulateCommitAckLost = false;
let testSimulateCommitFailure = false;
let testFaultOnOperationVerify = false;

export function setTestSimulateCommitAckLost(enabled: boolean): void {
  testSimulateCommitAckLost = enabled;
}

export function setTestSimulateCommitFailure(enabled: boolean): void {
  testSimulateCommitFailure = enabled;
}

export function setTestFaultOnOperationVerify(enabled: boolean): void {
  testFaultOnOperationVerify = enabled;
}

async function verifyProvisionOperationOutcome(
  verifyClient: PoolClient,
  operationId: string,
): Promise<GrantOperationOutcome> {
  if (testFaultOnOperationVerify) {
    return {
      status: "unknown",
      reason: "operation verification unavailable (test fault)",
    };
  }
  try {
    const committed = await isProvisionOperationCommitted(verifyClient, operationId);
    if (committed) {
      return { status: "committed" };
    }
    return { status: "rolled_back" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unknown", reason: message };
  }
}

/**
 * Commit grant transaction; if acknowledgment is lost, verify the specific operation id.
 * User existence by email does not prove this operation was committed.
 */
export async function finalizeGrantTransaction(
  client: PoolClient,
  verifyClient: PoolClient,
  operationId: string,
): Promise<GrantOperationOutcome> {
  try {
    if (testSimulateCommitFailure) {
      throw new Error("TEST_FAULT: commit failed");
    }
    await client.query("COMMIT");
    if (testSimulateCommitAckLost) {
      return verifyProvisionOperationOutcome(verifyClient, operationId);
    }
    return { status: "committed" };
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection may be unusable after ambiguous COMMIT
    }
    return verifyProvisionOperationOutcome(verifyClient, operationId);
  }
}

/** @deprecated Use markAdminProvisionIncomplete — blind delete is unsafe for recovery. */
export async function rollbackProvisionedAdminUser(
  client: PoolClient,
  input: { userId: string; actorUserId: string; basis: string; reason: string },
): Promise<void> {
  await markAdminProvisionIncomplete(client, input);
}
