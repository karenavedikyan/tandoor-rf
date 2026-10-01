import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDeadlineGroup,
  compareWorkQueueRows,
  getMskTodayKey,
} from "../../src/work/deadline-groups";

describe("work deadline groups", () => {
  const nowMs = Date.parse("2026-09-30T12:00:00+03:00");

  it("marks completed tasks as completed and not overdue", () => {
    assert.equal(
      classifyDeadlineGroup("completed", "2026-09-01T10:00:00+03:00", nowMs),
      "completed",
    );
  });

  it("classifies Moscow overdue, today, upcoming and no deadline", () => {
    assert.equal(getMskTodayKey(nowMs), "2026-09-30");
    assert.equal(
      classifyDeadlineGroup("in_progress", "2026-09-29T23:59:00+03:00", nowMs),
      "overdue",
    );
    assert.equal(
      classifyDeadlineGroup("in_progress", "2026-09-30T18:00:00+03:00", nowMs),
      "today",
    );
    assert.equal(
      classifyDeadlineGroup("in_progress", "2026-10-01T09:00:00+03:00", nowMs),
      "upcoming",
    );
    assert.equal(classifyDeadlineGroup("in_progress", null, nowMs), "no_deadline");
  });

  it("sorts overdue before upcoming and uses deadline tie-breaker", () => {
    const rows = [
      { deadlineGroup: "upcoming" as const, deadlineAt: "2026-10-05T10:00:00.000Z", taskId: "2" },
      { deadlineGroup: "overdue" as const, deadlineAt: "2026-09-28T10:00:00.000Z", taskId: "1" },
    ];
    rows.sort((a, b) => compareWorkQueueRows(a, b));
    assert.equal(rows[0]?.taskId, "1");
  });
});
