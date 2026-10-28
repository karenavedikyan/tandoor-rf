export function requireHandoffOtpPepper(): string {
  const pepper = process.env.TT_OTP_PEPPER?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!pepper || pepper.length < 16) {
      throw new Error("TT_OTP_PEPPER must be set to a secure value in production.");
    }
    return pepper;
  }
  if (pepper) return pepper;
  if (process.env.NODE_ENV === "test") {
    return "test-handoff-pepper-fixed";
  }
  return "local-dev-handoff-pepper-not-for-prod";
}

export const HANDOFF_CODE_TTL_MS = 5 * 60 * 1000;
export const HANDOFF_CODE_MAX_VERIFY_ATTEMPTS = 5;

export const PHONE_VERIFICATION_TTL_MS = 5 * 60 * 1000;
export const PHONE_VERIFICATION_MAX_ATTEMPTS = 5;
export const PHONE_SESSION_TTL_MS = 15 * 60 * 1000;
export const PHONE_SEND_COOLDOWN_MS = 60 * 1000;
export const PHONE_SEND_MAX_PER_WINDOW = 3;
export const PHONE_SEND_WINDOW_MS = 15 * 60 * 1000;
