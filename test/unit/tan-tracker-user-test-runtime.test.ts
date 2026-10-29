import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTanTrackerUserTestRuntimeDefaults,
  assertTanTrackerUserTestStartup,
  assertTanTrackerUserTestRuntimeIsolation,
} from "../../src/shared/tan-tracker-user-test-runtime";

const TT56_URL = "postgresql://u:p@127.0.0.1:5432/tandoor_rf_tt56_user_test";

describe("tan-tracker user test runtime isolation", () => {
  it("rejects inherited nightly enable when test mode requested", () => {
    const env = {
      TT_USER_TEST_ENV: "true",
      NODE_ENV: "development",
      DATABASE_URL: TT56_URL,
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
    };
    assert.throws(() => assertTanTrackerUserTestStartup(env), /ONEC_NIGHTLY_EXCHANGE_ENABLED/);
  });

  it("rejects wrong database when test mode requested", () => {
    const env = {
      TT_USER_TEST_ENV: "true",
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/not_tt56_db",
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
    };
    assert.throws(() => assertTanTrackerUserTestStartup(env), /Expected only/);
  });

  it("rejects production NODE_ENV when test mode requested", () => {
    const env = {
      TT_USER_TEST_ENV: "true",
      NODE_ENV: "production",
      DATABASE_URL: TT56_URL,
    };
    assert.throws(() => assertTanTrackerUserTestStartup(env), /NODE_ENV=production/);
  });

  it("applies safe defaults when unset on valid test config", () => {
    const env = {
      TT_USER_TEST_ENV: "true",
      NODE_ENV: "development",
      DATABASE_URL: TT56_URL,
    };
    applyTanTrackerUserTestRuntimeDefaults(env);
    assert.equal(env.ONEC_NIGHTLY_EXCHANGE_ENABLED, "false");
    assert.doesNotThrow(() => assertTanTrackerUserTestStartup(env));
  });

  it("legacy isolation helper still blocks forbidden flags when requested", () => {
    const env = {
      TT_USER_TEST_ENV: "true",
      NODE_ENV: "development",
      DATABASE_URL: TT56_URL,
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
    };
    assert.throws(() => assertTanTrackerUserTestRuntimeIsolation(env), /ONEC_NIGHTLY_EXCHANGE_ENABLED/);
  });
});
