import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClientsImportCliArgs } from "../../src/onec-clients/cli-args";
import { buildClientsFileSha256, sampleClient } from "../helpers/onec-clients-fixtures";

describe("onec clients cli args", () => {
  it("defaults to dry-run mode", () => {
    const parsed = parseClientsImportCliArgs([]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "dry_run");
    }
  });

  it("requires expected sha256 for apply", () => {
    assert.equal(parseClientsImportCliArgs(["--apply"]).ok, false);
    assert.equal(parseClientsImportCliArgs(["--expected-sha256", "abc"]).ok, false);
  });

  it("rejects unknown and contradictory arguments before runtime", () => {
    assert.equal(parseClientsImportCliArgs(["--force"]).ok, false);
    assert.equal(parseClientsImportCliArgs(["--apply", "--dry-run"]).ok, false);
    assert.equal(parseClientsImportCliArgs(["--expected-sha256", "abc", "--dry-run"]).ok, false);
  });

  it("accepts apply with valid sha256", () => {
    const hash = buildClientsFileSha256([sampleClient()]);
    const parsed = parseClientsImportCliArgs(["--apply", "--expected-sha256", hash]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "apply");
      assert.equal(parsed.options.expectedSha256, hash);
    }
  });
});
