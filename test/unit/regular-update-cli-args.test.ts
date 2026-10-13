import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRegularUpdateCliArgs } from "../../src/onec-regular-update/cli-args";

describe("parseRegularUpdateCliArgs", () => {
  it("defaults to dry_run when no mode flags", () => {
    const parsed = parseRegularUpdateCliArgs([]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "dry_run");
    }
  });

  it("selects dry_run with --dry-run", () => {
    const parsed = parseRegularUpdateCliArgs(["--dry-run"]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "dry_run");
    }
  });

  it("selects apply with --apply and --expected-fingerprint", () => {
    const parsed = parseRegularUpdateCliArgs(["--apply", "--expected-fingerprint", "abc123"]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "apply");
      assert.equal(parsed.options.expectedFingerprint, "abc123");
    }
  });

  it("rejects apply without expected fingerprint", () => {
    const parsed = parseRegularUpdateCliArgs(["--apply"]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.code, "APPLY_REQUIRES_EXPECTED_FINGERPRINT");
    }
  });

  it("rejects unknown arguments", () => {
    const parsed = parseRegularUpdateCliArgs(["--not-a-flag"]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.code, "UNKNOWN_ARGUMENT");
    }
  });
});
