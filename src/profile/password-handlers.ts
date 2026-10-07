import type { Response } from "express";
import { query } from "../db/pool";
import { hashPassword, validatePasswordInput, verifyPassword } from "../auth/password";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { toUserDto } from "../shared/user";
import type { AuthenticatedRequest } from "../middleware/auth";
import { ACCESS_AUDIT_ACTIONS } from "../access/constants";
import { USER_AUDIT_ENTITY_TYPE } from "../access/user-provisioning";

export async function changePasswordHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const body = req.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    setNoStore(res);
    res.status(400).json(
      apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите текущий и новый пароль."),
    );
    return;
  }

  const passwordCheck = validatePasswordInput(newPassword);
  if (!passwordCheck.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, passwordCheck.message));
    return;
  }

  const userId = req.authUser!.id;
  const row = await query<{
    password_hash: string;
    password_must_change: boolean;
  }>(
    `
      SELECT password_hash, password_must_change
      FROM users
      WHERE id = $1::uuid
    `,
    [userId],
  );
  const user = row.rows[0];
  if (!user) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Пользователь не найден."));
    return;
  }

  const currentOk = await verifyPassword(currentPassword, user.password_hash);
  if (!currentOk) {
    setNoStore(res);
    res.status(401).json(
      apiError(ERROR_CODES.INVALID_CREDENTIALS, "Текущий пароль указан неверно."),
    );
    return;
  }

  const newHash = await hashPassword(newPassword);
  const updated = await query<{
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
      UPDATE users
      SET
        password_hash = $2,
        password_must_change = FALSE,
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, email, full_name, phone, role, status, last_login_at, password_must_change
    `,
    [userId, newHash],
  );

  await query(
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
      userId,
      ACCESS_AUDIT_ACTIONS.USER_PASSWORD_CHANGE,
      USER_AUDIT_ENTITY_TYPE,
      JSON.stringify({ password_must_change: user.password_must_change }),
      JSON.stringify({ password_must_change: false }),
      "Self-service password change",
    ],
  );

  const dto = toUserDto(updated.rows[0]!);
  setNoStore(res);
  res.status(200).json({
    user: { ...dto, mustChangePassword: false },
  });
}
