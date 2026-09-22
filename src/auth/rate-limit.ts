import {
  LOGIN_EMAIL_MAX_ATTEMPTS,
  LOGIN_IP_MAX_ATTEMPTS,
  LOGIN_LOCK_MS,
  LOGIN_RATE_RETENTION_MS,
  LOGIN_RATE_WINDOW_MS,
} from "../config";
import { query } from "../db/pool";

export type RateLimitCheck =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

function emailBucketKey(email: string): string {
  return `email:${email}`;
}

function ipBucketKey(ip: string): string {
  return `ip:${ip}`;
}

/**
 * Atomically reserves one login attempt in the bucket before password verification.
 * Window semantics: attempts are counted inside a 15-minute sliding window;
 * the 6th email attempt within the window returns 429 with Retry-After up to 15 minutes.
 */
async function reserveBucketAttempt(
  bucketKey: string,
  maxAttempts: number,
): Promise<RateLimitCheck> {
  const result = await query<{
    attempt_count: number;
    locked_until: Date | null;
  }>(
    `
      INSERT INTO login_rate_limits (bucket_key, attempt_count, window_started_at, locked_until, updated_at)
      VALUES ($1, 1, NOW(), NULL, NOW())
      ON CONFLICT (bucket_key) DO UPDATE SET
        attempt_count = CASE
          WHEN login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until > NOW()
            THEN login_rate_limits.attempt_count
          WHEN login_rate_limits.window_started_at < NOW() - ($2 || ' milliseconds')::interval
            THEN 1
          ELSE login_rate_limits.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until > NOW()
            THEN login_rate_limits.window_started_at
          WHEN login_rate_limits.window_started_at < NOW() - ($2 || ' milliseconds')::interval
            THEN NOW()
          ELSE login_rate_limits.window_started_at
        END,
        locked_until = CASE
          WHEN login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until > NOW()
            THEN login_rate_limits.locked_until
          WHEN (
            CASE
              WHEN login_rate_limits.window_started_at < NOW() - ($2 || ' milliseconds')::interval THEN 1
              ELSE login_rate_limits.attempt_count + 1
            END
          ) > $3 THEN NOW() + ($4 || ' milliseconds')::interval
          ELSE NULL
        END,
        updated_at = NOW()
      RETURNING attempt_count, locked_until
    `,
    [bucketKey, String(LOGIN_RATE_WINDOW_MS), maxAttempts, String(LOGIN_LOCK_MS)],
  );

  const row = result.rows[0]!;
  const now = Date.now();
  if (row.locked_until && row.locked_until.getTime() > now) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((row.locked_until.getTime() - now) / 1000)),
    };
  }

  if (row.attempt_count > maxAttempts) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(LOGIN_LOCK_MS / 1000)),
    };
  }

  return { allowed: true };
}

export async function reserveLoginAttempt(
  email: string,
  ip: string | null,
): Promise<RateLimitCheck> {
  const emailCheck = await reserveBucketAttempt(
    emailBucketKey(email),
    LOGIN_EMAIL_MAX_ATTEMPTS,
  );
  if (!emailCheck.allowed) {
    return emailCheck;
  }

  if (ip) {
    const ipCheck = await reserveBucketAttempt(ipBucketKey(ip), LOGIN_IP_MAX_ATTEMPTS);
    if (!ipCheck.allowed) {
      return ipCheck;
    }
  }

  await query(
    `
      DELETE FROM login_rate_limits
      WHERE updated_at < NOW() - ($1 || ' milliseconds')::interval
        AND (locked_until IS NULL OR locked_until < NOW())
    `,
    [String(LOGIN_RATE_RETENTION_MS)],
  );

  return { allowed: true };
}

export async function clearLoginFailuresForEmail(email: string): Promise<void> {
  await query("DELETE FROM login_rate_limits WHERE bucket_key = $1", [emailBucketKey(email)]);
}
