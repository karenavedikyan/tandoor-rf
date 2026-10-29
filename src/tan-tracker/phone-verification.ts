import crypto from "crypto";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { isTanTrackerUserTestEnv } from "../shared/tan-tracker-user-test-env";

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

function testPhoneProviderAllowed(): boolean {
  if (process.env.TT_PHONE_VERIFICATION_PROVIDER !== "test") return false;
  if (process.env.NODE_ENV === "test") return true;
  return isTanTrackerUserTestEnv();
}

function userTestOtpDir(): string {
  return (
    process.env.TT_USER_TEST_OTP_DIR?.trim() ||
    path.join(process.cwd(), "var/tt56-user-test/otp")
  );
}

async function persistUserTestOtpFile(transferId: string, partyId: string, code: string): Promise<void> {
  if (!isTanTrackerUserTestEnv()) return;
  const dir = userTestOtpDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${transferId}_${partyId}.json`);
  await fs.writeFile(
    filePath,
    JSON.stringify({ transferId, partyId, code, createdAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
}

/** Integration tests and isolated user-test env — read OTP from memory/file. */
export function peekTestPhoneVerificationCode(transferId: string, partyId: string): string | null {
  if (process.env.NODE_ENV === "test") {
    return testCodes.get(testPhoneCodeKey(transferId, partyId)) ?? null;
  }
  if (!isTanTrackerUserTestEnv()) return null;
  try {
    const raw = readFileSync(path.join(userTestOtpDir(), `${transferId}_${partyId}.json`), "utf8");
    const parsed = JSON.parse(raw) as { code?: string };
    return typeof parsed.code === "string" ? parsed.code : null;
  } catch {
    return null;
  }
}

export function storeTestPhoneVerificationCode(transferId: string, partyId: string, code: string): void {
  if (!testPhoneProviderAllowed()) return;
  testCodes.set(testPhoneCodeKey(transferId, partyId), code);
  void persistUserTestOtpFile(transferId, partyId, code).catch(() => {
    /* best-effort operator file */
  });
}

/** Production must wire a real provider; tests use TestPhoneVerificationProvider. */
export function resolvePhoneVerificationProvider(): PhoneVerificationProvider {
  if (testPhoneProviderAllowed()) {
    return {
      async sendCode() {
        return { deliveryId: "test" };
      },
    };
  }
  throw new PhoneVerificationUnavailableError();
}
