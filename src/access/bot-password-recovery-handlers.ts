import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import { reserveLoginAttempt } from "../auth/rate-limit";
import { getClientIp } from "../http/request-ip";
import { normalizeEmail } from "../validation/email";
import { buildSessionCookie } from "../auth/cookie";
import { toUserDto } from "../shared/user";
import { createRecoveryDelivery } from "./password-recovery-delivery";
import { loginWithRecoveryCode, RecoveryError, requestPasswordRecovery, type RecoveryChannel, type RecoveryDelivery } from "./password-reset-service";

const str = (v: unknown): string => typeof v === "string" ? v : "";
export const PUBLIC_RECOVERY_MESSAGE = "Если аккаунт активен и восстановление доступно, код отправлен в бот назначенного администратора (для сотрудника) или в собственный бот (для администратора). Сотруднику нужно связаться с администратором для проверки личности и получения кода. Код действует 10 минут; новый запрос доступен не чаще раза в минуту.";

export function botPasswordRecoveryHandler(mode: "admin" | "request" | "login", delivery: RecoveryDelivery = createRecoveryDelivery()) {
  return async (req: Request, res: Response): Promise<void> => {
    setNoStore(res);
    const pool = getPool();
    if (!pool) { res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: "База данных недоступна." } }); return; }
    const body = req.body ?? {}, auth = req as AuthenticatedRequest;
    const email = normalizeEmail(str(body.email)) ?? "invalid";
    const limit = await reserveLoginAttempt(
      `recovery:${mode}:${mode === "admin" ? auth.authUser?.id ?? "anonymous" : email}`,
      `recovery:${getClientIp(req) ?? "unknown"}`,
    );
    if (!limit.allowed) {
      res.set("Retry-After", String(limit.retryAfterSec));
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Слишком много попыток. Повторите позже." } }); return;
    }
    try {
      if (mode === "login") {
        const result = await loginWithRecoveryCode(pool, str(body.email), str(body.code).trim());
        if (!result) {
          res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Неверный или истёкший код. Запросите новый." } }); return;
        }
        const user = (await pool.query("SELECT * FROM users WHERE id=$1::uuid", [result.userId])).rows[0];
        res.set("Set-Cookie", buildSessionCookie(result.token));
        res.status(200).json({ user: toUserDto(user) });
      } else {
        if (!["max", "telegram"].includes(str(body.channel))) throw new RecoveryError(400, "VALIDATION_ERROR", "Выберите MAX или Telegram.");
        await requestPasswordRecovery(pool, {
          email: str(body.email), channel: body.channel as RecoveryChannel,
          admin: mode === "admin" ? {
            actorId: auth.authUser!.id, sessionId: auth.sessionId!, currentPassword: str(body.currentPassword),
            confirmed: body.confirmed === true, basis: str(body.basis),
          } : undefined,
        }, delivery);
        res.status(202).json({ message: mode === "admin"
          ? "Код отправлен в ваш подключённый бот. Передайте его сотруднику лично; действующий пароль изменится только после входа по коду."
          : PUBLIC_RECOVERY_MESSAGE });
      }
    } catch (error) {
      if (!(error instanceof RecoveryError)) throw error;
      // Public response never exposes account existence, bot binding or provider delivery state.
      if (mode === "request" && error.code === "DELIVERY_UNAVAILABLE") {
        res.status(202).json({ message: PUBLIC_RECOVERY_MESSAGE }); return;
      }
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
  };
}
