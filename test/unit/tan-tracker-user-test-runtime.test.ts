import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTanTrackerUserTestRuntimeDefaults,
  assertTanTrackerUserTestRuntimeIsolation,
} from "../../src/shared/tan-tracker-user-test-runtime";

const TT56_URL = "postgresql://u:p@127.0.0.1:5432/tandoor_rf_tt56_user_test";

describe("tan-tracker user test runtime isolation", () => {
  it("rejects inherited nightly enable on user-test stand", () => {
    const env = {
      TT_USER_TEST_ENV: "true",
      NODE_ENV: "development",
      DATABASE_URL: TT56_URL,
      ONEC_NIGHTLY_EXCHANGE_ENABLED: "true",
    };
    applyTanTrackerUserTestRuntimeDefaults(env);
    assert.throws(() => assertTanTrackerUserTestRuntimeIsolation(env), /ONEC_NIGHTLY_EXCHANGE_ENABLED/);
  });

  it("applies safe defaults when unset", () => {
    const env = {
      TT_USER_TEST_ENV: "true",
      NODE_ENV: "development",
      DATABASE_URL: TT56_URL,
    };
    applyTanTrackerUserTestRuntimeDefaults(env);
    assert.equal(env.ONEC_NIGHTLY_EXCHANGE_ENABLED, "false");
    assert.doesNotThrow(() => assertTanTrackerUserTestRuntimeIsolation(env));
  });
});
