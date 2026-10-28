import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PhoneVerificationUnavailableError,
  resolvePhoneVerificationProvider,
} from "../../src/tan-tracker/phone-verification";

describe("tan-tracker phone verification provider", () => {
  it("rejects test provider when NODE_ENV is production", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevProvider = process.env.TT_PHONE_VERIFICATION_PROVIDER;
    process.env.NODE_ENV = "production";
    process.env.TT_PHONE_VERIFICATION_PROVIDER = "test";
    try {
      assert.throws(() => resolvePhoneVerificationProvider(), PhoneVerificationUnavailableError);
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.TT_PHONE_VERIFICATION_PROVIDER = prevProvider;
    }
  });
});
