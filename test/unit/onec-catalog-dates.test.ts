import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isExpectedCalendarExpired,
  markExpectedCalendarExpiry,
  parseExpectedCalendar,
} from "../../src/onec-catalog/dates";

describe("onec catalog expected calendar parser", () => {
  it("parses DD.MM.YYYY HH:MM:SS without attaching a timezone", () => {
    const parsed = parseExpectedCalendar("10.08.2026 12:00:00");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.parts.day, 10);
      assert.equal(parsed.parts.month, 8);
      assert.equal(parsed.parts.year, 2026);
      assert.equal(parsed.parts.hour, 12);
    }
  });

  it("flags expired expectations by calendar date only", () => {
    const parsed = parseExpectedCalendar("10.08.2026 12:00:00");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      const marked = markExpectedCalendarExpiry(parsed, new Date("2026-10-01T00:00:00Z"));
      assert.equal(marked.expired, true);
      assert.equal(
        isExpectedCalendarExpired(parsed.parts, new Date("2026-08-10T23:59:59Z")),
        false,
      );
    }
  });

  it("rejects impossible calendar dates", () => {
    assert.equal(parseExpectedCalendar("31.02.2026 12:00:00").ok, false);
  });
});
