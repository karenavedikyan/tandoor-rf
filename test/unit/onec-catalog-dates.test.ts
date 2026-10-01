import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExpectedDate } from "../../src/onec-catalog/dates";

describe("onec catalog expected date parser", () => {
  it("parses DD.MM.YYYY HH:MM:SS and flags past dates", () => {
    const parsed = parseExpectedDate("10.08.2026 12:00:00", new Date("2026-10-01T00:00:00Z"));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.expired, true);
      assert.match(parsed.iso, /^2026-08-10T12:00:00Z$/);
    }
  });

  it("rejects impossible calendar dates", () => {
    assert.equal(parseExpectedDate("31.02.2026 12:00:00").ok, false);
  });
});
