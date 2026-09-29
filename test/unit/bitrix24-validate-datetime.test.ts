import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOptionalBitrixDate } from "../../src/bitrix24/validate-datetime";

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

  it("treats missing deadline as absent", () => {
    assert.deepEqual(parseOptionalBitrixDate(null), { kind: "absent" });
    assert.deepEqual(parseOptionalBitrixDate(""), { kind: "absent" });
  });
});
