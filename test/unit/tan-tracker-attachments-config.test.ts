import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTanTrackerAttachmentsProductionBackend,
  resolveTanTrackerAttachmentsBackend,
} from "../../src/shared/tan-tracker-attachments-config";

describe("tan-tracker attachments backend config", () => {
  it("defaults production to postgres and test stand to filesystem", () => {
    assert.equal(
      resolveTanTrackerAttachmentsBackend({ NODE_ENV: "production", TT_USER_TEST_ENV: "false" }),
      "postgres",
    );
    assert.equal(
      resolveTanTrackerAttachmentsBackend({ NODE_ENV: "production", TT_ATTACHMENTS_BACKEND: "postgres" }),
      "postgres",
    );
    assert.equal(
      resolveTanTrackerAttachmentsBackend({ NODE_ENV: "test", TT_USER_TEST_ENV: "true", DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/tandoor_rf_tt56_user_test" }),
      "filesystem",
    );
  });

  it("rejects ephemeral filesystem on production without explicit override", () => {
    assert.throws(() =>
      assertTanTrackerAttachmentsProductionBackend({
        NODE_ENV: "production",
        TT_ATTACHMENTS_BACKEND: "filesystem",
      }),
    );
    assert.doesNotThrow(() =>
      assertTanTrackerAttachmentsProductionBackend({
        NODE_ENV: "production",
        TT_ATTACHMENTS_BACKEND: "filesystem",
        TT_ATTACHMENTS_ALLOW_EPHEMERAL_FS: "true",
      }),
    );
  });
});
