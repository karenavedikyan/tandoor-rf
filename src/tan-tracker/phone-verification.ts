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

const testCodes = new Map<string, string>();

export function testPhoneCodeKey(transferId: string, partyId: string): string {
  return `${transferId}|${partyId}`;
}

/** Integration tests only — read OTP written by test provider. */
export function peekTestPhoneVerificationCode(transferId: string, partyId: string): string | null {
  if (process.env.NODE_ENV !== "test") return null;
  return testCodes.get(testPhoneCodeKey(transferId, partyId)) ?? null;
}

export function storeTestPhoneVerificationCode(transferId: string, partyId: string, code: string): void {
  if (process.env.NODE_ENV !== "test") return;
  testCodes.set(testPhoneCodeKey(transferId, partyId), code);
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
