import type { Response } from "express";
import { query } from "../db/pool";
import {
  hasUnknownProfilePatchKeys,
  normalizeFullName,
  normalizePhone,
} from "../validation/profile";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { toUserDto } from "../shared/user";
import type { AuthenticatedRequest } from "../middleware/auth";

export async function getSelfProfileHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  sendUser(res, req.authUser!);
}

function sendUser(res: Response, user: ReturnType<typeof toUserDto>): void {
  setNoStore(res);
  res.status(200).json({ user });
}

export async function patchSelfProfileHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (hasUnknownProfilePatchKeys(body)) {
    setNoStore(res);
    res.status(400).json(
      apiError(ERROR_CODES.VALIDATION_ERROR, "Переданы недопустимые поля."),
    );
    return;
  }

  if (!("fullName" in body) && !("phone" in body)) {
    setNoStore(res);
    res.status(400).json(
      apiError(ERROR_CODES.VALIDATION_ERROR, "Нет полей для обновления."),
    );
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  if ("fullName" in body) {
    const fullName = normalizeFullName(body.fullName);
    if (!fullName) {
      setNoStore(res);
      res.status(400).json(
        apiError(
          ERROR_CODES.VALIDATION_ERROR,
          "ФИО должно содержать от 2 до 200 символов.",
        ),
      );
      return;
    }
    updates.push(`full_name = $${index++}`);
    params.push(fullName);
  }

  if ("phone" in body) {
    const phone = normalizePhone(body.phone);
    if (phone === undefined) {
      setNoStore(res);
      res.status(400).json(
        apiError(
          ERROR_CODES.VALIDATION_ERROR,
          "Укажите корректный российский номер телефона или оставьте поле пустым.",
        ),
      );
      return;
    }
    updates.push(`phone = $${index++}`);
    params.push(phone);
  }

  params.push(req.authUser!.id);
  const result = await query<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
  }>(
    `
      UPDATE users
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${index}
      RETURNING id, email, full_name, phone, role, status, last_login_at
    `,
    params,
  );

  sendUser(res, toUserDto(result.rows[0]!));
}
