import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNotApprovedExecutionManifestTemplate } from "../../src/onec-sales/matched-only/production/manifest-template";
import { computeExecutionManifestContentHash } from "../../src/onec-sales/matched-only/production/manifest-hash";
import { validateExecutionManifestForRun } from "../../src/onec-sales/matched-only/production/manifest-validate";
import { EXPECTED_PRODUCTION_DB_FINGERPRINT } from "../../src/onec-sales/matched-only/production/target-policy";

describe("matched-only production execution manifest", () => {
  it("NOT_APPROVED template has stable contentHash and rejects write", () => {
    const template = buildNotApprovedExecutionManifestTemplate("apply");
    assert.equal(template.approval.status, "NOT_APPROVED");
    assert.equal(template.plan, null);
    assert.equal(computeExecutionManifestContentHash(template), template.contentHash);
    const write = validateExecutionManifestForRun({
      manifest: template,
      operation: "apply",
      requireApproved: true,
      approvedExecutionHash: "abc",
    });
    assert.equal(write.ok, false);
    if (!write.ok) {
      assert.equal(write.code, "MANIFEST_NOT_APPROVED");
    }
  });

  it("tampered contentHash is rejected", () => {
    const template = buildNotApprovedExecutionManifestTemplate("rollback");
    const tampered = { ...template, contentHash: "0".repeat(64) };
    const result = validateExecutionManifestForRun({
      manifest: tampered,
      operation: "rollback",
      requireApproved: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "MANIFEST_CONTENT_HASH_MISMATCH");
    }
  });

  it("pins expected production DB fingerprint in template", () => {
    const template = buildNotApprovedExecutionManifestTemplate("apply");
    assert.equal(template.target.expectedDbFingerprint, EXPECTED_PRODUCTION_DB_FINGERPRINT);
  });
});
