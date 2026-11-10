import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashPassword, verifyPassword } from "../auth/password";
import { createOpaqueToken } from "../auth/session";
import { normalizeEmail } from "../validation/email";
import { requireHandoffOtpPepper } from "../tan-tracker/otp-config";

export type RecoveryChannel = "max" | "telegram";
export type RecoveryDelivery = (input: {
  channel: RecoveryChannel; userId: string; chatId: string; text: string;
}) => Promise<boolean>;
export type AdminResetProof = { actorId: string; sessionId: string; currentPassword: string; confirmed: boolean; basis: string };
export class RecoveryError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export const credentialFingerprint = (value: string): string => createHash("sha256").update(value).digest("hex");
export const hashRecoveryCode = (id: string, code: string): string =>
  createHmac("sha256", requireHandoffOtpPepper()).update(`password-recovery:${id}:${code}`).digest("hex");
export function matchesRecoveryCode(id: string, code: string, stored: string | null): boolean {
  if (!stored || !/^\d{8}$/.test(code)) return false;
  const expected = Buffer.from(stored, "hex"), actual = Buffer.from(hashRecoveryCode(id, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
type User = { id: string; email: string; full_name: string; role: string; status: string; password_hash: string; password_must_change: boolean };
type Destination = { messenger_user_id: string; messenger_chat_id: string; linked_at: Date };
type Challenge = Destination & {
  id: string; user_id: string; recipient_user_id: string; initiated_session_id: string | null;
  channel: RecoveryChannel; code_hash: string | null; credential_fingerprint: string; recipient_fingerprint: string;
};
async function atomic<T>(pool: Pool, run: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout TO '5s'");
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK"); throw e;
  } finally { c.release(); }
}
async function audit(c: PoolClient, actor: string, target: string, action: string, basis: string, channel: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await c.query(
    `INSERT INTO access_audit_log(actor_user_id,action,entity_type,entity_id,after_json,basis)
     VALUES($1::uuid,$2,'user',$3::uuid,$4::jsonb,$5)`,
    [actor, action, target, JSON.stringify({ channel, recipient_user_id: actor, ...metadata }), basis],
  );
}
async function destination(c: PoolClient, channel: RecoveryChannel, userId: string): Promise<Destination | undefined> {
  // channel is validated before use; table/column names never come from user strings.
  const prefix = channel === "max" ? "max" : "telegram";
  return (await c.query<Destination>(
    `SELECT ${prefix}_user_id::text AS messenger_user_id,${prefix}_chat_id::text AS messenger_chat_id,linked_at
     FROM tanbot_${prefix}_accounts WHERE user_id=$1::uuid
     AND stopped_at IS NULL AND notifications_enabled=TRUE FOR UPDATE`, [userId],
  )).rows[0];
}
async function liveSession(c: PoolClient, sessionId: string, userId: string): Promise<boolean> {
  return !!(await c.query(
    `SELECT id FROM sessions WHERE id=$1::uuid AND user_id=$2::uuid AND revoked_at IS NULL
     AND expires_at>NOW() AND preview_user_id IS NULL FOR UPDATE`, [sessionId, userId],
  )).rowCount;
}

/** A public request only delivers to the target's existing bot; admin requests only to the actor's bot. */
export async function requestPasswordRecovery(
  pool: Pool, input: { email: string; channel: RecoveryChannel; admin?: AdminResetProof }, deliver: RecoveryDelivery,
): Promise<boolean> {
  const email = normalizeEmail(input.email);
  if (!email || !["max", "telegram"].includes(input.channel)) {
    throw new RecoveryError(400, "VALIDATION_ERROR", "Укажите корректный логин и выберите MAX или Telegram.");
  }
  return atomic(pool, async c => {
    const r = await c.query<User>(
      `SELECT id,email,full_name,role,status,password_hash,password_must_change FROM users
       WHERE LOWER(BTRIM(email))=$1 OR id=$2::uuid ORDER BY id FOR UPDATE`,
      [email, input.admin?.actorId ?? null],
    );
    const target = r.rows.find(u => u.email.trim().toLowerCase() === email);
    let recipient = target;
    if (input.admin) {
      const proof = input.admin;
      recipient = r.rows.find(u => u.id === proof.actorId);
      if (!proof.confirmed || !proof.basis.trim() || proof.basis.length > 500 ||
          !recipient || recipient.role !== "admin" || recipient.status !== "active" ||
          recipient.password_must_change || !await liveSession(c, proof.sessionId, proof.actorId) ||
          Buffer.byteLength(proof.currentPassword) > 72 ||
          !await verifyPassword(proof.currentPassword, recipient.password_hash)) {
        throw new RecoveryError(403, "FORBIDDEN", "Подтвердите операцию паролем действующего администратора и укажите основание.");
      }
      if (!target || target.role === "admin" || target.id === recipient.id || target.status !== "active") {
        throw new RecoveryError(400, "INVALID_TARGET", "Выберите активного сотрудника без роли администратора.");
      }
    }
    if (!target || target.status !== "active" || !recipient) return false;
    const route = await destination(c, input.channel, recipient.id);
    if (!route) {
      if (input.admin) throw new RecoveryError(409, "BOT_NOT_LINKED", "Подключите выбранный бот в своём профиле и разрешите уведомления.");
      return false;
    }
    if ((await c.query(
      "SELECT 1 FROM password_recovery_challenges WHERE user_id=$1::uuid AND created_at>NOW()-INTERVAL '60 seconds'",
      [target.id],
    )).rowCount) {
      if (input.admin) throw new RecoveryError(429, "RATE_LIMITED", "Новый код можно запросить через минуту.");
      return false;
    }
    const id = randomUUID(), code = String(randomInt(10_000_000, 100_000_000));
    await c.query(
      `UPDATE password_recovery_challenges SET cancelled_at=NOW(),code_hash=NULL
       WHERE user_id=$1::uuid AND used_at IS NULL AND cancelled_at IS NULL`, [target.id],
    );
    await c.query(
      `INSERT INTO password_recovery_challenges(id,user_id,recipient_user_id,initiated_session_id,channel,
       messenger_user_id,messenger_chat_id,linked_at,code_hash,credential_fingerprint,recipient_fingerprint,expires_at)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,NOW()+INTERVAL '10 minutes')`,
      [id, target.id, recipient.id, input.admin?.sessionId ?? null, input.channel,
        route.messenger_user_id, route.messenger_chat_id, route.linked_at,
        hashRecoveryCode(id, code), credentialFingerprint(target.password_hash), credentialFingerprint(recipient.password_hash)],
    );
    // Write audit before sending; an audit failure never leaks a usable, unaudited code.
    // Anonymous requests live in the challenge table, not under a forged authenticated audit actor.
    if (input.admin) await audit(c, recipient.id, target.id, "user.password_recovery_requested",
      input.admin.basis.trim(), input.channel);
    let sent = false;
    try {
      sent = await deliver({
        channel: input.channel, userId: route.messenger_user_id, chatId: route.messenger_chat_id,
        text: `Тандор. Восстановление доступа.\nДля кого: ${target.full_name.replace(/[\r\n\t\u202a-\u202e\u2066-\u2069]/g, " ")}\nЛогин сотрудника: ${target.email}\n` +
          (input.admin ? `Запросил администратор: ${recipient.full_name.replace(/[\r\n\t\u202a-\u202e\u2066-\u2069]/g, " ")} (${recipient.email}).\n`
            : "Запрос: со страницы входа без авторизации. Личность инициатора ещё не подтверждена.\n") +
          `Временный код: ${code}\nДействует 10 минут, только для одного входа с обязательной сменой пароля.\n` +
          (input.admin ? "Вы запросили код как администратор. Передайте его только указанному сотруднику лично."
            : "Никому не сообщайте код. Если вы не запрашивали восстановление, проигнорируйте сообщение."),
      });
    } catch { /* Never expose provider errors, token URLs or message bodies. */ }
    if (!sent) throw new RecoveryError(503, "DELIVERY_UNAVAILABLE", "Не удалось отправить код. Действующий пароль не изменён. Повторите запрос позже.");
    return true;
  });
}

/** Redemption changes credentials only after bot possession is proven. The session can only change password. */
export async function loginWithRecoveryCode(pool: Pool, emailRaw: string, code: string): Promise<{ token: string; userId: string } | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  return atomic(pool, async c => {
    // Discover the recipient, then acquire every user lock in a stable order.
    const candidate = (await c.query<Challenge>(
      `SELECT r.* FROM password_recovery_challenges r JOIN users u ON u.id=r.user_id
       WHERE LOWER(BTRIM(u.email))=$1 AND r.used_at IS NULL AND r.cancelled_at IS NULL`, [email],
    )).rows[0];
    if (!candidate) return null;
    const users = await c.query<User>(
      "SELECT id,email,full_name,role,status,password_hash,password_must_change FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[candidate.user_id, candidate.recipient_user_id]],
    );
    const row = (await c.query<Challenge>(
      `SELECT * FROM password_recovery_challenges WHERE id=$1::uuid AND used_at IS NULL
       AND cancelled_at IS NULL AND expires_at>NOW() AND attempts<5 FOR UPDATE`, [candidate.id],
    )).rows[0];
    const target = users.rows.find(u => u.id === candidate.user_id);
    const recipient = users.rows.find(u => u.id === candidate.recipient_user_id);
    if (!row || !target || !recipient || target.email.trim().toLowerCase() !== email ||
        target.status !== "active" || recipient.status !== "active" ||
        credentialFingerprint(target.password_hash) !== row.credential_fingerprint ||
        credentialFingerprint(recipient.password_hash) !== row.recipient_fingerprint) return null;
    if (target.id !== recipient.id &&
        (recipient.role !== "admin" || target.role === "admin" || !row.initiated_session_id ||
         !await liveSession(c, row.initiated_session_id, recipient.id))) return null;
    const route = await destination(c, row.channel, recipient.id);
    if (!route || route.messenger_user_id !== row.messenger_user_id ||
        route.messenger_chat_id !== row.messenger_chat_id ||
        route.linked_at.getTime() !== row.linked_at.getTime()) return null;
    if (!matchesRecoveryCode(row.id, code, row.code_hash)) {
      await c.query("UPDATE password_recovery_challenges SET attempts=attempts+1 WHERE id=$1::uuid", [row.id]);
      return null; // Commit the failed attempt rather than rolling it back.
    }
    await c.query("UPDATE password_recovery_challenges SET used_at=NOW() WHERE id=$1::uuid", [row.id]);
    // An unknown random password disables ordinary login with the old password or the consumed code.
    await c.query(
      "UPDATE users SET password_hash=$2,password_must_change=TRUE,updated_at=NOW() WHERE id=$1::uuid",
      [target.id, await hashPassword(createOpaqueToken())],
    );
    await c.query("UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL", [target.id]);
    const token = createOpaqueToken();
    await c.query(
      `INSERT INTO sessions(user_id,token_hash,expires_at,password_recovery_challenge_id)
       VALUES($1::uuid,$2,NOW()+INTERVAL '10 minutes',$3::uuid)`,
      [target.id, credentialFingerprint(token), row.id],
    );
    await audit(c, target.id, target.id, "user.password_recovery_login",
      target.id === recipient.id ? "Self-service recovery code redeemed" : "Admin-issued employee recovery code redeemed", row.channel,
      { recipient_user_id: recipient.id, issued_by_admin_user_id: target.id === recipient.id ? null : recipient.id });
    return { token, userId: target.id };
  });
}
