import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TT56_USER_TEST_DATABASE_NAME,
  assertTanTrackerUserTestDatabaseUrl,
  isTanTrackerUserTestEnv,
} from "../../src/shared/tan-tracker-user-test-env";
import {
  PhoneVerificationUnavailableError,
  resolvePhoneVerificationProvider,
} from "../../src/tan-tracker/phone-verification";

describe("tan-tracker user test env guards", () => {
  it("allows only dedicated database name", () => {
    assert.throws(
      () =>
        assertTanTrackerUserTestDatabaseUrl(
          "postgresql://u:p@127.0.0.1:5432/tandoor_rf_test",
          "test",
        ),
      new RegExp(TT56_USER_TEST_DATABASE_NAME),
    );
    assert.doesNotThrow(() =>
      assertTanTrackerUserTestDatabaseUrl(
        `postgresql://u:p@127.0.0.1:5432/${TT56_USER_TEST_DATABASE_NAME}`,
        "test",
      ),
    );
  });

  it("requires TT_USER_TEST_ENV and non-production for flag", () => {
    const url = `postgresql://u:p@127.0.0.1:5432/${TT56_USER_TEST_DATABASE_NAME}`;
    assert.equal(
      isTanTrackerUserTestEnv({
        TT_USER_TEST_ENV: "true",
        DATABASE_URL: url,
        NODE_ENV: "development",
      }),
      true,
    );
    assert.equal(
      isTanTrackerUserTestEnv({
        TT_USER_TEST_ENV: "true",
        DATABASE_URL: url,
        NODE_ENV: "production",
      }),
      false,
    );
    assert.equal(
      isTanTrackerUserTestEnv({
        TT_USER_TEST_ENV: "false",
        DATABASE_URL: url,
        NODE_ENV: "development",
      }),
      false,
    );
  });

  it("allows test SMS provider only in NODE_ENV=test or user-test env", () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      TT_PHONE_VERIFICATION_PROVIDER: process.env.TT_PHONE_VERIFICATION_PROVIDER,
      TT_USER_TEST_ENV: process.env.TT_USER_TEST_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    try {
      process.env.TT_PHONE_VERIFICATION_PROVIDER = "test";
      process.env.NODE_ENV = "production";
      process.env.TT_USER_TEST_ENV = "true";
      process.env.DATABASE_URL = `postgresql://u:p@127.0.0.1:5432/${TT56_USER_TEST_DATABASE_NAME}`;
      assert.throws(() => resolvePhoneVerificationProvider(), PhoneVerificationUnavailableError);

      process.env.NODE_ENV = "development";
      assert.doesNotThrow(() => resolvePhoneVerificationProvider());
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
