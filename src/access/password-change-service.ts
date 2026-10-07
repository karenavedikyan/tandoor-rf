import type { Pool, PoolClient } from "pg";
import { hashPassword, validatePasswordInput, verifyPassword } from "../auth/password";
import { toUserDto, type UserDto } from "../shared/user";
import { ACCESS_AUDIT_ACTIONS } from "./constants";
import { USER_AUDIT_ENTITY_TYPE } from "./user-provisioning";

let testFaultBeforePasswordChangeAudit = false;

/** @internal test-only */
export function setTestFaultBeforePasswordChangeAudit(enabled: boolean): void {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  testFaultBeforePasswordChangeAudit = enabled;
}

export type ChangePasswordInput = {
  userId: string;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
};

export type ChangePasswordResult =
  | { ok: true; user: UserDto }
  | {
      ok: false;
      code: "VALIDATION_ERROR" | "INVALID_CREDENTIALS" | "SAME_PASSWORD" | "NOT_FOUND";
      message: string;
    };

async function changePasswordOnClient(
  client: PoolClient,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  if (!input.currentPassword || !input.newPassword) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Укажите текущий и новый пароль.",
    };
  }

  const passwordCheck = validatePasswordInput(input.newPassword);
  if (!passwordCheck.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: passwordCheck.message };
  }

  const row = await client.query<{
    password_hash: string;
    password_must_change: boolean;
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
  }>(
    `
      SELECT
        id,
        email,
        full_name,
        phone,
        role,
        status,
        last_login_at,
        password_hash,
        password_must_change
      FROM users
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [input.userId],
  );
  const user = row.rows[0];
  if (!user) {
    return { ok: false, code: "NOT_FOUND", message: "Пользователь не найден." };
  }

  const currentOk = await verifyPassword(input.currentPassword, user.password_hash);
  if (!currentOk) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "Текущий пароль указан неверно.",
    };
  }

  const sameAsCurrent = await verifyPassword(input.newPassword, user.password_hash);
  if (sameAsCurrent) {
    return {
      ok: false,
      code: "SAME_PASSWORD",
      message: "Новый пароль должен отличаться от текущего.",
    };
  }

  const newHash = await hashPassword(input.newPassword);
  const beforeAudit = { password_must_change: user.password_must_change };

  await client.query(
    `
      UPDATE users
      SET
        password_hash = $2,
        password_must_change = FALSE,
        updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [input.userId, newHash],
  );

  await client.query(
    `
      UPDATE sessions
      SET revoked_at = NOW()
      WHERE user_id = $1::uuid
        AND id <> $2::uuid
        AND revoked_at IS NULL
    `,
    [input.userId, input.sessionId],
  );

  if (testFaultBeforePasswordChangeAudit) {
    throw new Error("Simulated audit write failure.");
  }

  await client.query(
    `
      INSERT INTO access_audit_log (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        basis
      )
      VALUES ($1::uuid, $2, $3, $1::uuid, $4::jsonb, $5::jsonb, $6)
    `,
    [
      input.userId,
      ACCESS_AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
      USER_AUDIT_ENTITY_TYPE,
      JSON.stringify(beforeAudit),
      JSON.stringify({ password_must_change: false, sessions_revoked: true }),
      "Self-service password change",
    ],
  );

  const updated = await client.query<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
    password_must_change: boolean;
  }>(
    `
      SELECT id, email, full_name, phone, role, status, last_login_at, password_must_change
      FROM users
      WHERE id = $1::uuid
    `,
    [input.userId],
  );

  return { ok: true, user: toUserDto(updated.rows[0]!) };
}

export async function changePasswordAtomically(
  pool: Pool,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await changePasswordOnClient(client, input);
    if (!result.ok) {
      await client.query("ROLLBACK");
      return result;
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
