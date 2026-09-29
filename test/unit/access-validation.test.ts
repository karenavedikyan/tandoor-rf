import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDelegationWindow, parseStrictClientGuids } from "../../src/access/validation";

describe("access validation", () => {
  it("rejects non-array clientGuids", () => {
    const result = parseStrictClientGuids("not-array");
    assert.ok("error" in result);
  });

  it("rejects invalid UUID in clientGuids", () => {
    const result = parseStrictClientGuids([
      "11111111-1111-4111-8111-111111111111",
      "invalid-guid",
    ]);
    assert.ok("error" in result);
  });

  it("deduplicates clientGuids", () => {
    const guid = "11111111-1111-4111-8111-111111111111";
    const result = parseStrictClientGuids([guid, guid]);
    assert.ok("guids" in result);
    assert.deepEqual(result.guids, [guid]);
  });

  it("rejects endsAt before startsAt", () => {
    const result = parseDelegationWindow("2026-09-28T12:00:00.000Z", "2026-09-28T10:00:00.000Z");
    assert.ok("error" in result);
  });
});
