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
