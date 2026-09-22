import type { Request, Response } from "express";
import { buildSessionCookie, clearSessionCookie, parseSessionToken } from "./cookie";
import {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from "./rate-limit";
import {
  createSession,
  revokeSessionByToken,
} from "./session";
import {
  DUMMY_PASSWORD_HASH,
  passwordByteLength,
  verifyPassword,
} from "./password";
import { query } from "../db/pool";
import { normalizeEmail } from "../validation/email";
import { getClientIp } from "../http/request-ip";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { toUserDto, type UserDto } from "../shared/user";
import type { AuthenticatedRequest } from "../middleware/auth";

const INVALID_CREDENTIALS_MESSAGE = "Неверный email или пароль.";

function sendUser(res: Response, user: UserDto): void {
  setNoStore(res);
  res.status(200).json({ user });
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { email?: unknown; password?: unknown } | undefined;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email) {
    setNoStore(res);
    res.status(400).json(
      apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите корректный email."),
    );
    return;
  }

  if (!password) {
    setNoStore(res);
    res.status(400).json(
      apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите пароль."),
    );
    return;
  }

  const ip = getClientIp(req);
  const rateLimit = await assertLoginAllowed(email, ip);
  if (!rateLimit.allowed) {
    setNoStore(res);
    res.set("Retry-After", String(rateLimit.retryAfterSec));
    res.status(429).json(
      apiError(
        ERROR_CODES.RATE_LIMITED,
        "Слишком много попыток входа. Повторите позже.",
      ),
    );
    return;
  }

  const userResult = await query<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
    password_hash: string;
  }>(
    `
      SELECT id, email, full_name, phone, role, status, last_login_at, password_hash
      FROM users
      WHERE LOWER(BTRIM(email)) = $1
      LIMIT 1
    `,
    [email],
  );

  const user = userResult.rows[0];
  if (passwordByteLength(password) > 72) {
    await recordLoginFailure(email, ip);
    setNoStore(res);
    res.status(401).json(
      apiError(ERROR_CODES.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE),
    );
    return;
  }

  const hashToVerify =
    user && user.status === "active" ? user.password_hash : DUMMY_PASSWORD_HASH;
  const passwordOk = await verifyPassword(password, hashToVerify);

  if (!user || user.status !== "active" || !passwordOk) {
    await recordLoginFailure(email, ip);
    setNoStore(res);
    res.status(401).json(
      apiError(ERROR_CODES.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE),
    );
    return;
  }

  const session = await createSession(user.id);
  await clearLoginFailures(email, ip);
  await query(
    `
      UPDATE users
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `,
    [user.id],
  );

  const refreshed = await query<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string;
    status: string;
    last_login_at: Date | null;
  }>(
    `
      SELECT id, email, full_name, phone, role, status, last_login_at
      FROM users
      WHERE id = $1
    `,
    [user.id],
  );

  setNoStore(res);
  res.set("Set-Cookie", buildSessionCookie(session.token));
  res.status(200).json({ user: toUserDto(refreshed.rows[0]!) });
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  const token = parseSessionToken(req.headers.cookie);
  if (token) {
    try {
      await revokeSessionByToken(token);
    } catch {
      // logout remains idempotent even if DB fails mid-flight
    }
  }

  setNoStore(res);
  res.set("Set-Cookie", clearSessionCookie());
  res.status(200).json({ ok: true });
}

export async function meHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  sendUser(res, req.authUser!);
}
