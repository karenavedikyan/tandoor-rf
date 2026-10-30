import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  signHolderAccess,
  verifyHolderAccess,
  verifyHolderAccessAllowExpired,
} from "../../src/tan-tracker/holder-access";

describe("holder access tokens", () => {
  it("rejects expired token for mutation but allows refresh parse", () => {
    process.env.TT_OTP_PEPPER = process.env.TT_OTP_PEPPER || "unit-test-otp-pepper-16b";
    const token = signHolderAccess({
      transferId: "t1",
      partyId: "00000000-0000-4000-8000-000000000001",
      hv: 1,
      exp: Date.now() - 1000,
    });
    assert.equal(verifyHolderAccess(token), null);
    assert.equal(verifyHolderAccessAllowExpired(token)?.hv, 1);
  });
});
