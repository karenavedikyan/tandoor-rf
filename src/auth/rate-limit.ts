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

async function checkBucket(
  bucketKey: string,
  maxAttempts: number,
): Promise<RateLimitCheck> {
  const now = Date.now();
  const result = await query<{
    attempt_count: number;
    window_started_at: Date;
    locked_until: Date | null;
  }>(
    `
      SELECT attempt_count, window_started_at, locked_until
      FROM login_rate_limits
      WHERE bucket_key = $1
    `,
    [bucketKey],
  );

  const row = result.rows[0];
  if (row?.locked_until && row.locked_until.getTime() > now) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((row.locked_until.getTime() - now) / 1000)),
    };
  }

  if (row) {
    const windowAge = now - row.window_started_at.getTime();
    if (windowAge <= LOGIN_RATE_WINDOW_MS && row.attempt_count >= maxAttempts) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(LOGIN_LOCK_MS / 1000)),
      };
    }
  }

  return { allowed: true };
}

export async function assertLoginAllowed(
  email: string,
  ip: string | null,
): Promise<RateLimitCheck> {
  const emailCheck = await checkBucket(emailBucketKey(email), LOGIN_EMAIL_MAX_ATTEMPTS);
  if (!emailCheck.allowed) {
    return emailCheck;
  }
  if (ip) {
    const ipCheck = await checkBucket(ipBucketKey(ip), LOGIN_IP_MAX_ATTEMPTS);
    if (!ipCheck.allowed) {
      return ipCheck;
    }
  }
  return { allowed: true };
}

async function incrementBucket(bucketKey: string, maxAttempts: number): Promise<void> {
  await query(
    `
      INSERT INTO login_rate_limits (bucket_key, attempt_count, window_started_at, locked_until, updated_at)
      VALUES ($1, 1, NOW(), NULL, NOW())
      ON CONFLICT (bucket_key) DO UPDATE SET
        attempt_count = CASE
          WHEN login_rate_limits.window_started_at < NOW() - ($2 || ' milliseconds')::interval THEN 1
          ELSE login_rate_limits.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN login_rate_limits.window_started_at < NOW() - ($2 || ' milliseconds')::interval THEN NOW()
          ELSE login_rate_limits.window_started_at
        END,
        locked_until = CASE
          WHEN (
            CASE
              WHEN login_rate_limits.window_started_at < NOW() - ($2 || ' milliseconds')::interval THEN 1
              ELSE login_rate_limits.attempt_count + 1
            END
          ) >= $3 THEN NOW() + ($4 || ' milliseconds')::interval
          ELSE login_rate_limits.locked_until
        END,
        updated_at = NOW()
    `,
    [bucketKey, String(LOGIN_RATE_WINDOW_MS), maxAttempts, String(LOGIN_LOCK_MS)],
  );
}

export async function recordLoginFailure(
  email: string,
  ip: string | null,
): Promise<void> {
  await incrementBucket(emailBucketKey(email), LOGIN_EMAIL_MAX_ATTEMPTS);
  if (ip) {
    await incrementBucket(ipBucketKey(ip), LOGIN_IP_MAX_ATTEMPTS);
  }
  await query(
    `
      DELETE FROM login_rate_limits
      WHERE updated_at < NOW() - ($1 || ' milliseconds')::interval
        AND (locked_until IS NULL OR locked_until < NOW())
    `,
    [String(LOGIN_RATE_RETENTION_MS)],
  );
}

export async function clearLoginFailures(email: string, ip: string | null): Promise<void> {
  await query("DELETE FROM login_rate_limits WHERE bucket_key = $1", [emailBucketKey(email)]);
  if (ip) {
    await query("DELETE FROM login_rate_limits WHERE bucket_key = $1", [ipBucketKey(ip)]);
  }
}
