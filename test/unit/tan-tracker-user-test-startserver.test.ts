import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

describe("startServer tt56 fail-closed", () => {
  const saved = { ...process.env };

  after(() => {
    process.env = saved;
  });

  it("throws before binding when TT_USER_TEST_ENV with wrong DATABASE_URL", async () => {
    process.env.TT_USER_TEST_ENV = "true";
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:5432/wrong_tt56_db";
    process.env.PORT = "38777";
    process.env.ONEC_NIGHTLY_EXCHANGE_ENABLED = "true";

    const { startServer } = await import("../../src/server");
    assert.throws(() => startServer(), /Refusing|Expected only/);
  });

  it("throws before binding when TT_USER_TEST_ENV with production NODE_ENV", async () => {
    process.env.TT_USER_TEST_ENV = "true";
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:5432/tandoor_rf_tt56_user_test";
    process.env.PORT = "38778";

    const { startServer } = await import("../../src/server");
    assert.throws(() => startServer(), /NODE_ENV=production/);
  });
});
