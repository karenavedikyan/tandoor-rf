import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMoscowWallClock,
  isWithinNightlyWindow,
  nightlyWindowKey,
} from "../../src/onec-nightly-exchange/msk-time";

describe("nightly exchange MSK window", () => {
  it("detects inside and outside schedule window", () => {
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
    assert.equal(nightlyWindowKey(inside), "2026-10-07");
    assert.equal(getMoscowWallClock(inside).minutesSinceMidnight, 2 * 60 + 45);
  });
});
