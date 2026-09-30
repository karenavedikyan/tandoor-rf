import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBitrix24DiagnosticsCliArgs } from "../../src/bitrix24/diagnostics-cli-args";

describe("bitrix24 diagnostics cli args", () => {
  it("requires bitrix user id", () => {
    const parsed = parseBitrix24DiagnosticsCliArgs([]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.code, "BITRIX_USER_ID_REQUIRED");
    }
  });

  it("accepts explicit user id", () => {
    const parsed = parseBitrix24DiagnosticsCliArgs(["--bitrix-user-id", "42"]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.bitrixUserId, "42");
    }
  });

  it("rejects invalid user id", () => {
    const parsed = parseBitrix24DiagnosticsCliArgs(["--bitrix-user-id", "abc"]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.code, "INVALID_BITRIX_USER_ID");
    }
  });
});
