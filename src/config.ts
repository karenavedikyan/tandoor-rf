export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "tandoor_rf_session";

/** Failed login attempts per email within the window before a temporary lock. */
export const LOGIN_EMAIL_MAX_ATTEMPTS = 5;
/** Failed login attempts per IP within the window before a temporary lock. */
export const LOGIN_IP_MAX_ATTEMPTS = 20;
/** Sliding window length for login rate limits. */
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
/** Temporary lock duration after the threshold is exceeded. */
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
/** Retention for idle rate-limit rows (garbage collection). */
export const LOGIN_RATE_RETENTION_MS = 24 * 60 * 60 * 1000;

export const JSON_BODY_LIMIT = "16kb";
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD_LENGTH = 12;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDevelopmentLike(): boolean {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv === "development" || nodeEnv === "test" || !nodeEnv;
}

export function getDatabaseUrl(): string | undefined {
  const value = process.env.DATABASE_URL?.trim();
  return value || undefined;
}

export function getAppOrigin(): string | undefined {
  const value = process.env.APP_ORIGIN?.trim();
  return value || undefined;
}
