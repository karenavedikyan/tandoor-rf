import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProductionCliArgs } from "../../src/onec-sales/matched-only/production/cli-args";

describe("matched-only production CLI args", () => {
  it("rejects conflicting preflight and write flags before DB connect", () => {
    const result = parseProductionCliArgs([
      "--preflight",
      "--write-apply",
      "--manifest-file",
      "/tmp/m.json",
      "--approved-execution-hash",
      "a".repeat(64),
    ]);
    assert.equal(result.ok, false);
  });

  it("requires approved execution hash for write-apply", () => {
    const result = parseProductionCliArgs(["--write-apply", "--manifest-file", "/tmp/m.json"]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "CLI_ARGS_INVALID");
    }
  });

  it("accepts preflight with manifest file", () => {
    const result = parseProductionCliArgs(["--preflight", "--manifest-file", "/tmp/m.json", "--operation", "apply"]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.args.mode, "preflight");
      assert.equal(result.args.operation, "apply");
    }
  });
});
