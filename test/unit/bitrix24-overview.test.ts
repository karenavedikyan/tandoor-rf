import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTaskOverviewMetadata as meta } from "../../src/bitrix24/tasks/overview-metadata";

const NOW = Date.parse("2026-09-30T20:00:00Z");
describe("authorized task overview metadata", () => {
  it("recognizes overdue, future and absent deadlines", () => {
    assert.deepEqual(meta("in_progress", "2026-09-30T20:00:00+03:00", true, NOW), {
      isOpen: true, isOverdue: true, deadlineAt: "2026-09-30T17:00:00.000Z",
    });
    assert.equal(meta("waiting", "2026-10-01T20:00:00+03:00", true, NOW).isOverdue, false);
    assert.deepEqual(meta("deferred", null, true, NOW), { isOpen: true, isOverdue: false, deadlineAt: null });
  });
  it("never treats completed tasks as overdue", () => {
    assert.equal(meta("completed", "2020-01-01T00:00:00Z", true, NOW).isOverdue, false);
    assert.equal(meta("completed", null, false, NOW).isOpen, false);
  });
  it("keeps unknown status or malformed deadline unknown", () => {
    assert.equal(meta("unknown", "2020-01-01T00:00:00Z", true, NOW).isOpen, null);
    assert.equal(meta("unknown", "2020-01-01T00:00:00Z", true, NOW).isOverdue, null);
    assert.equal(meta("waiting", "not-a-date", true, NOW).isOverdue, null);
  });
  it("never exposes or derives a hidden deadline for a brief-only viewer", () => {
    assert.deepEqual(meta("in_progress", "2020-01-01T00:00:00Z", false, NOW), {
      isOpen: true, isOverdue: null, deadlineAt: null,
    });
  });
});
