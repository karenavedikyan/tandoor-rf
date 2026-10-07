import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateTemporaryPassword } from "../../src/access/user-provisioning";
import { validatePasswordInput } from "../../src/auth/password";

describe("user provisioning helpers", () => {
  it("generates passwords that satisfy policy", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const password = generateTemporaryPassword();
      assert.equal(validatePasswordInput(password).ok, true);
      assert.ok(password.length >= 12);
    }
  });
});
