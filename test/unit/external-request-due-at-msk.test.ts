import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { externalRequestDueAtFromMode } from "../../src/tan-tracker/external-request/due-at-msk";

describe("external request due at MSK end-of-day", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("today is 23:59 Europe/Moscow on the same MSK calendar day", () => {
    const due = externalRequestDueAtFromMode("today", now);
    assert.ok(due);
    assert.equal(due!.toISOString(), "2026-10-30T20:59:00.000Z");
  });

  it("tomorrow is 23:59 Europe/Moscow on the next MSK calendar day", () => {
    const due = externalRequestDueAtFromMode("tomorrow", now);
    assert.ok(due);
    assert.equal(due!.toISOString(), "2026-10-31T20:59:00.000Z");
  });
});
