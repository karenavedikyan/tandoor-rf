import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBitrix24ProbeCliArgs } from "../../src/bitrix24/cli-args";

describe("bitrix24 probe cli args", () => {
  it("defaults to local-only diagnostics", () => {
    const parsed = parseBitrix24ProbeCliArgs([]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.live, false);
    }
  });

  it("requires bitrix user id with live flag", () => {
    const parsed = parseBitrix24ProbeCliArgs(["--live"]);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.code, "LIVE_REQUIRES_BITRIX_USER_ID");
    }
  });

  it("accepts live mode with explicit user id", () => {
    const parsed = parseBitrix24ProbeCliArgs(["--live", "--bitrix-user-id", "42"]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.live, true);
      assert.equal(parsed.options.bitrixUserId, "42");
    }
  });
});
