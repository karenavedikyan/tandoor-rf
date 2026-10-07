import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMoscowWallClock,
  isWithinNightlyWindow,
  resolveActiveNightlyWindow,
  windowBoundsForStartDate,
} from "../../src/onec-nightly-exchange/msk-time";

describe("nightly exchange MSK window", () => {
  it("detects inside and outside same-day schedule window", () => {
    const inside = new Date("2026-10-06T23:45:00.000Z");
    const outside = new Date("2026-10-07T11:00:00.000Z");
    assert.equal(
      isWithinNightlyWindow({ now: inside, scheduleTime: "02:30", windowMinutes: 60 }),
      true,
    );
    assert.equal(
      isWithinNightlyWindow({ now: outside, scheduleTime: "02:30", windowMinutes: 60 }),
      false,
    );
    assert.equal(getMoscowWallClock(inside).minutesSinceMidnight, 2 * 60 + 45);
  });

  it("keeps start-date window key across midnight span", () => {
    const bounds = windowBoundsForStartDate("2026-10-06", "23:30", 120);
    assert.equal(bounds.windowKey, "2026-10-06");
    assert.equal(bounds.startAt.toISOString(), "2026-10-06T20:30:00.000Z");
    assert.equal(bounds.deadlineAt.toISOString(), "2026-10-06T22:30:00.000Z");

    const beforeMidnight = new Date("2026-10-06T21:00:00.000Z");
    const afterMidnight = new Date("2026-10-06T22:00:00.000Z");
    const activeBefore = resolveActiveNightlyWindow({
      now: beforeMidnight,
      scheduleTime: "23:30",
      windowMinutes: 120,
    });
    const activeAfter = resolveActiveNightlyWindow({
      now: afterMidnight,
      scheduleTime: "23:30",
      windowMinutes: 120,
    });
    assert.equal(activeBefore?.windowKey, "2026-10-06");
    assert.equal(activeAfter?.windowKey, "2026-10-06");
    assert.equal(activeBefore != null, true);
    assert.equal(activeAfter != null, true);
  });

  it("does not silently truncate windows that end after midnight", () => {
    const bounds = windowBoundsForStartDate("2026-10-06", "23:30", 120);
    assert.equal(bounds.deadlineAt.getTime() - bounds.startAt.getTime(), 120 * 60 * 1000);
    const outsideAfterClose = new Date("2026-10-06T22:31:00.000Z");
    assert.equal(
      resolveActiveNightlyWindow({
        now: outsideAfterClose,
        scheduleTime: "23:30",
        windowMinutes: 120,
      }),
      null,
    );
  });
});
