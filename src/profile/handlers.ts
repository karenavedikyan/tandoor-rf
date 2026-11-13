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
import { withTransaction } from "../access/db";
import { lockPhonePartyResolution } from "../tan-tracker/phone-party-resolver";
import { findProfilesByPhone } from "../tan-tracker/profile-phone";

export async function getSelfProfileHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const intake = await query<{ accepts_external_tt_intake: boolean; additional_phone: string | null }>(
    `SELECT accepts_external_tt_intake,additional_phone FROM users WHERE id = $1::uuid LIMIT 1`,
    [req.authUser!.id],
  );
  const user = {
    ...req.authUser!,
    acceptsExternalTtIntake: intake.rows[0]?.accepts_external_tt_intake === true,
    additionalPhone: intake.rows[0]?.additional_phone ?? null,
  };
  setNoStore(res);
  res.status(200).json({ user });
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

  if (!("fullName" in body) && !("phone" in body) && !("additionalPhone" in body)) {
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
  if ("additionalPhone" in body) {
    const phone = normalizePhone(body.additionalPhone);
    if (phone === undefined) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR,
        "Укажите корректный дополнительный российский номер телефона или оставьте поле пустым."));
      return;
    }
    updates.push(`additional_phone = $${index++}`);
    params.push(phone);
  }

  params.push(req.authUser!.id);
  type ProfileRow = {
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    additional_phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
  };
  try {
    const result = await withTransaction(async client => {
      if ("phone" in body || "additionalPhone" in body) {
        const snapshot = (await client.query<{ phone: string | null; additional_phone: string | null }>(
          `SELECT phone,additional_phone FROM users WHERE id=$1::uuid`, [req.authUser!.id],
        )).rows[0]!;
        const phone = "phone" in body ? normalizePhone(body.phone)! : snapshot.phone;
        const additional = "additionalPhone" in body ? normalizePhone(body.additionalPhone)! : snapshot.additional_phone;
        if (phone && phone === additional) {
          throw Object.assign(new Error("Дополнительный телефон должен отличаться от основного."), { http: 400 });
        }
        // Acquire phone locks before user row locks, in a stable order for swaps/concurrent saves.
        const phones = [...new Set([snapshot.phone, snapshot.additional_phone, phone, additional]
          .filter((p): p is string => !!p))].sort();
        for (const p of phones) await lockPhonePartyResolution(client, p);
        const current = (await client.query<{ phone: string | null; additional_phone: string | null }>(
          `SELECT phone,additional_phone FROM users WHERE id=$1::uuid FOR NO KEY UPDATE`, [req.authUser!.id],
        )).rows[0]!;
        if (current.phone !== snapshot.phone || current.additional_phone !== snapshot.additional_phone) {
          throw Object.assign(new Error("Профиль уже изменился. Обновите страницу и повторите сохранение."), { http: 409 });
        }
        for (const p of new Set([phone, additional].filter((p): p is string => !!p))) {
          const matches = await findProfilesByPhone(client, p, "share");
          if (matches.some(user => user.id !== req.authUser!.id)) {
            throw Object.assign(new Error("Этот телефон уже указан в другом профиле. Укажите свой номер."), { http: 409 });
          }
        }
      }
      return client.query<ProfileRow>(
        `UPDATE users
         SET ${updates.join(", ")}, updated_at = NOW()
         WHERE id = $${index}
         RETURNING id, email, full_name, phone, additional_phone, role, status, last_login_at`,
        params,
      );
    });

    sendUser(res, toUserDto(result.rows[0]!));
  } catch (err) {
    const http = (err as { http?: number }).http;
    if (http !== 400 && http !== 409) throw err;
    setNoStore(res);
    res.status(http).json(apiError(ERROR_CODES.VALIDATION_ERROR, (err as Error).message));
  }
}
