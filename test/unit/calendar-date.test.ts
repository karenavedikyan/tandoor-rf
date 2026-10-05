import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calendarDateToTimestamptz,
  formatCalendarDateFromTimestamptz,
  parseCalendarDateInput,
} from "../../src/shared/calendar-date";

describe("calendar date parsing", () => {
  it("accepts DD.MM.YYYY including leap day", () => {
    const parsed = parseCalendarDateInput("29.02.2024");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.isoDate, "2024-02-29");
      assert.equal(calendarDateToTimestamptz(parsed.isoDate), "2024-02-29T12:00:00.000Z");
    }
  });

  it("accepts ISO calendar date", () => {
    const parsed = parseCalendarDateInput("2026-10-05");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.isoDate, "2026-10-05");
    }
  });

  it("rejects impossible calendar dates", () => {
    assert.equal(parseCalendarDateInput("31.02.2024").ok, false);
    assert.equal(parseCalendarDateInput("29.02.2023").ok, false);
    assert.equal(parseCalendarDateInput("not-a-date").ok, false);
  });

  it("formats stored timestamptz without timezone day shift", () => {
    assert.equal(
      formatCalendarDateFromTimestamptz("2026-10-05T12:00:00.000Z"),
      "05.10.2026",
    );
  });
});
