import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidTimezoneOffset, parseOptionalBitrixDate } from "../../src/bitrix24/validate-datetime";

describe("parseOptionalBitrixDate", () => {
  it("preserves timezone when present", () => {
    const parsed = parseOptionalBitrixDate("2026-09-30T12:00:00+03:00");
    assert.equal(parsed.kind, "valid");
    if (parsed.kind === "valid") {
      assert.equal(parsed.value, "2026-09-30T12:00:00+03:00");
    }
  });

  it("accepts timezone-less datetime without inventing timezone", () => {
    const parsed = parseOptionalBitrixDate("2026-09-30T12:00:00");
    assert.equal(parsed.kind, "valid");
    if (parsed.kind === "valid") {
      assert.equal(parsed.value, "2026-09-30T12:00:00");
    }
  });

  it("rejects impossible calendar dates", () => {
    assert.equal(parseOptionalBitrixDate("2026-02-30T12:00:00+03:00").kind, "invalid");
  });

  it("rejects invalid timezone offsets in changedAt and deadline", () => {
    for (const value of [
      "2026-09-30T12:00:00+99:99",
      "2026-09-30T12:00:00+03:99",
      "2026-09-30T12:00:00+14:30",
    ]) {
      assert.equal(parseOptionalBitrixDate(value).kind, "invalid", value);
    }
  });

  it("accepts boundary timezone offsets for both signs", () => {
    for (const value of [
      "2026-09-30T12:00:00Z",
      "2026-09-30T12:00:00+00:00",
      "2026-09-30T12:00:00+14:00",
      "2026-09-30T12:00:00-14:00",
      "2026-09-30T12:00:00+05:30",
      "2026-09-30T12:00:00-05:30",
    ]) {
      assert.equal(parseOptionalBitrixDate(value).kind, "valid", value);
    }
  });

  it("validates timezone offset components explicitly", () => {
    assert.equal(isValidTimezoneOffset("Z"), true);
    assert.equal(isValidTimezoneOffset("+03:00"), true);
    assert.equal(isValidTimezoneOffset("-12:00"), true);
    assert.equal(isValidTimezoneOffset("+99:99"), false);
    assert.equal(isValidTimezoneOffset("+03:99"), false);
    assert.equal(isValidTimezoneOffset("+14:30"), false);
  });

  it("treats missing deadline as absent", () => {
    assert.deepEqual(parseOptionalBitrixDate(null), { kind: "absent" });
    assert.deepEqual(parseOptionalBitrixDate(""), { kind: "absent" });
  });
});
