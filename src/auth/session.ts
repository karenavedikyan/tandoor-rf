import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query } from "../db/pool";
import { SESSION_TTL_MS } from "../config";
import { toUserDto, type UserDto } from "../shared/user";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timingSafeEqualHex(storedHex: string, plainToken: string): boolean {
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHex, "hex");
  } catch {
    return false;
  }
  const computed = createHash("sha256").update(plainToken, "utf8").digest();
  if (stored.length !== computed.length) {
    return false;
  }
  return timingSafeEqual(stored, computed);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string): Promise<{ token: string; sessionId: string }> {
  const token = createOpaqueToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const result = await query<{ id: string }>(
    `
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [userId, tokenHash, expiresAt.toISOString()],
  );

  return { token, sessionId: result.rows[0]!.id };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query(
    `
      UPDATE sessions
      SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
    `,
    [sessionId],
  );
}

export async function revokeSessionByToken(token: string): Promise<string | null> {
  const tokenHash = sha256Hex(token);
  const result = await query<{ id: string }>(
    `
      UPDATE sessions
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id
    `,
    [tokenHash],
  );
  return result.rows[0]?.id ?? null;
}

export async function resolveSessionUser(token: string): Promise<{
  user: UserDto;
  sessionId: string;
} | null> {
  const tokenHash = sha256Hex(token);
  const result = await query<{
    session_id: string;
    token_hash: string;
    expires_at: Date;
    revoked_at: Date | null;
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
        s.id AS session_id,
        s.token_hash,
        s.expires_at,
        s.revoked_at,
        u.id,
        u.email,
        u.full_name,
        u.phone,
        u.role,
        u.status,
        u.last_login_at
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
      LIMIT 1
    `,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row || row.revoked_at) {
    return null;
  }
  if (!timingSafeEqualHex(row.token_hash, token)) {
    return null;
  }
  if (row.expires_at.getTime() <= Date.now()) {
    return null;
  }
  if (row.status !== "active") {
    return null;
  }

  return {
    sessionId: row.session_id,
    user: toUserDto(row),
  };
}
