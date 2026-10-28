import crypto from "crypto";

export type PhoneVerificationProvider = {
  sendCode(input: {
    phoneE164: string;
    transferId: string;
    partyId: string;
  }): Promise<{ deliveryId: string }>;
};

export class PhoneVerificationUnavailableError extends Error {
  constructor(message = "Подтверждение телефона недоступно: SMS-провайдер не настроен.") {
    super(message);
    this.name = "PhoneVerificationUnavailableError";
  }
}

export function hashOtp(code: string, pepper: string): string {
  return crypto.createHmac("sha256", pepper).update(code).digest("hex");
}

export function generateNumericOtp(length = 6): string {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, "0");
}

/** Production must wire a real provider; tests use TestPhoneVerificationProvider. */
export function resolvePhoneVerificationProvider(): PhoneVerificationProvider {
  const isTestEnv = process.env.NODE_ENV === "test";
  if (isTestEnv && process.env.TT_PHONE_VERIFICATION_PROVIDER === "test") {
    return {
      async sendCode() {
        return { deliveryId: "test" };
      },
    };
  }
  throw new PhoneVerificationUnavailableError();
}
